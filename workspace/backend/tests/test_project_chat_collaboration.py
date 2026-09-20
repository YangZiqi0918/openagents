"""Real local-account project channels share messages without sharing access."""

import pytest
from sqlalchemy import select

from app.config import config
from app.models import Channel, ChannelMember, FileRecord, WorkspaceMember


@pytest.fixture
def project_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "project-chat-test-signing-key-long-enough")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")
    monkeypatch.setattr(config, "ROUTER_LLM_ENABLED", False)
    monkeypatch.setattr(config, "FRONTEND_BASE_URL", "http://localhost:3000")
    for task in (
        "app.services.push.fanout_for_event",
        "app.services.cloud_agent.invoke_cloud_agents",
        "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event",
    ):
        monkeypatch.setattr(task, lambda *_args: None)


def _account(client, username):
    result = client.post("/v1/auth/local/register", json={"username": username, "password": "simplepass"})
    assert result.status_code == 200, result.text
    data = result.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _project(client, headers, name):
    response = client.post("/v1/workspaces", headers=headers, json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["data"]["workspaceId"]


def _event(client, headers, project_id, event_type, payload, target="core"):
    return client.post("/v1/events", headers=headers, json={
        "network": project_id, "type": event_type, "source": "human:forged",
        "target": target, "payload": payload,
    })


def _poll(client, headers, project_id):
    return client.get("/v1/events", headers=headers, params={
        "network": project_id, "channel": "shared", "type": "workspace.message.posted",
    })


def test_two_accounts_share_a_project_channel_but_not_another_project(project_auth, client, db):
    alice, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    _, carol_headers = _account(client, "carol")
    project_p = _project(client, alice_headers, "P")
    project_q = _project(client, alice_headers, "Q")

    invitation = client.post(f"/v1/workspaces/{project_p}/invites", headers=alice_headers,
                             json={"username": "bob", "role": "member"})
    assert invitation.status_code == 200, invitation.text
    invite_token = invitation.json()["data"]["url"].rsplit("/", 1)[-1]
    assert client.post(f"/v1/invites/{invite_token}/accept", headers=bob_headers).status_code == 200

    db.add_all([
        WorkspaceMember(workspace_id=project_p, agent_name="p-agent", status="online", agent_type="cloud:openai"),
        WorkspaceMember(workspace_id=project_q, agent_name="q-agent", status="online", agent_type="cloud:openai"),
    ])
    db.commit()

    cross_agent = _event(client, alice_headers, project_p, "network.channel.create", {
        "name": "foreign", "title": "Foreign agent", "participants": ["q-agent"],
    })
    assert cross_agent.status_code == 400, cross_agent.text

    created = _event(client, alice_headers, project_p, "network.channel.create", {
        "name": "shared", "title": "Shared", "participants": ["p-agent"], "master": "p-agent",
    })
    assert created.status_code == 200, created.text
    assert created.json()["data"]["metadata"]["channel_name"] == "shared"
    assert _event(client, alice_headers, project_q, "network.channel.create", {
        "name": "shared", "title": "Also shared", "participants": ["q-agent"],
    }).status_code == 200

    channel = db.execute(select(Channel).where(Channel.workspace_id == project_p,
                                               Channel.name == "shared")).scalar_one()
    assert [row.agent_name for row in db.execute(select(ChannelMember).where(
        ChannelMember.channel_id == channel.id)).scalars().all()] == ["p-agent"]

    discovered = client.get("/v1/discover", headers=bob_headers, params={"network": project_p})
    assert discovered.status_code == 200, discovered.text
    assert {row["address"] for row in discovered.json()["data"]["channels"]} >= {"channel/shared"}
    assert client.get("/v1/discover", headers=bob_headers, params={"network": project_q}).status_code in {401, 403}

    a_message = _event(client, alice_headers, project_p, "workspace.message.posted", {
        "content": "Alice's project P message", "sender_display_name": "forged",
    }, "channel/shared")
    b_message = _event(client, bob_headers, project_p, "workspace.message.posted", {
        "content": "Bob's reply",
    }, "channel/shared")
    assert a_message.status_code == b_message.status_code == 200, (a_message.text, b_message.text)
    assert a_message.json()["data"]["source"] == f"human:{alice['identity_key']}"
    assert b_message.json()["data"]["source"] == f"human:{bob['identity_key']}"
    assert a_message.json()["data"]["payload"]["sender_display_name"] == "alice"
    assert a_message.json()["data"]["metadata"]["target_agents"] == ["p-agent"]

    for headers in (alice_headers, bob_headers):
        fetched = _poll(client, headers, project_p)
        assert fetched.status_code == 200, fetched.text
        texts = [event["payload"]["content"] for event in fetched.json()["data"]["events"]]
        assert texts == ["Alice's project P message", "Bob's reply"]

    q_message = _event(client, alice_headers, project_q, "workspace.message.posted", {
        "content": "Q-only secret",
    }, "channel/shared")
    assert q_message.status_code == 200, q_message.text
    assert [event["payload"]["content"] for event in _poll(client, alice_headers, project_q).json()["data"]["events"]] == ["Q-only secret"]
    assert _poll(client, bob_headers, project_q).status_code in {401, 403}
    assert _poll(client, carol_headers, project_p).status_code in {401, 403}


def test_project_viewer_reads_but_cannot_send_and_foreign_attachment_is_rejected(project_auth, client, db):
    _, owner_headers = _account(client, "alice")
    _, viewer_headers = _account(client, "bob")
    project_p = _project(client, owner_headers, "P")
    project_q = _project(client, owner_headers, "Q")
    invitation = client.post(f"/v1/workspaces/{project_p}/invites", headers=owner_headers,
                             json={"username": "bob", "role": "viewer"})
    assert invitation.status_code == 200, invitation.text
    token = invitation.json()["data"]["url"].rsplit("/", 1)[-1]
    assert client.post(f"/v1/invites/{token}/accept", headers=viewer_headers).status_code == 200
    assert _event(client, owner_headers, project_p, "network.channel.create", {
        "name": "shared", "title": "Shared", "participants": [],
    }).status_code == 200

    assert client.get("/v1/discover", headers=viewer_headers, params={"network": project_p}).status_code == 200
    assert _poll(client, viewer_headers, project_p).status_code == 200
    assert _event(client, viewer_headers, project_p, "workspace.message.posted", {
        "content": "viewer cannot post",
    }, "channel/shared").status_code in {401, 403}

    foreign = FileRecord(workspace_id=project_q, filename="private.txt", size=4,
                         storage_key="unused-test-key", uploaded_by="human:alice")
    db.add(foreign)
    db.commit()
    assert _event(client, owner_headers, project_p, "workspace.message.posted", {
        "content": "unsafe", "attachments": [{"fileId": foreign.id}],
    }, "channel/shared").status_code == 400
