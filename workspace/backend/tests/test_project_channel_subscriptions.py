"""Project channel notification state is private to each human member."""

import pytest
from sqlalchemy.orm import sessionmaker

from app.config import config
from app.models import Channel, ChannelHumanMember, DeviceToken, Workspace, WorkspaceMembership
from app.services import push


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "test-channel-subscription-signing-key")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def _account(client, username):
    response = client.post("/v1/auth/local/register", json={"username": username, "password": "simplepass"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _project(client, db, headers, name="P"):
    response = client.post("/v1/workspaces", headers=headers, json={"name": name})
    assert response.status_code == 200, response.text
    project_id = response.json()["data"]["workspaceId"]
    channel = Channel(workspace_id=project_id, name="conversation", status="active")
    db.add(channel)
    db.commit()
    return project_id, channel.id


def _add_member(db, project_id, user, role="member"):
    db.add(WorkspaceMembership(workspace_id=project_id, user_id=user["id"], role=role))
    db.commit()


def _post(client, project_id, headers, content="hello"):
    return client.post("/v1/events", headers=headers, json={
        "network": project_id, "type": "workspace.message.posted",
        "source": "human:forged", "target": "channel/conversation",
        "payload": {"content": content, "message_type": "chat"},
    })


def _subscription(project_id):
    return f"/v1/workspaces/{project_id}/channels/conversation/subscription"


def test_subscription_viewer_can_follow_only_themselves_and_first_post_preserves_unfollow(
    local_auth, client, db,
):
    alice, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    _, stranger_headers = _account(client, "stranger")
    project_id, channel_id = _project(client, db, alice_headers)
    other_id, _ = _project(client, db, alice_headers, "Other")
    _add_member(db, project_id, bob, "viewer")
    url = _subscription(project_id)

    assert client.get(url, headers=bob_headers).json()["data"] == {"following": False}
    assert client.put(url, headers=bob_headers, json={"following": True}).json()["data"] == {"following": True}
    assert client.get(url, headers=alice_headers).json()["data"] == {"following": False}
    assert client.put(url, headers=bob_headers, json={"following": False}).json()["data"] == {"following": False}
    assert client.get(url, headers=stranger_headers).status_code in {401, 403}
    assert client.put(url, headers={"X-Workspace-Token": db.get(Workspace, project_id).password_hash},
                      json={"following": True}).status_code in {401, 403}
    assert client.get(_subscription(other_id), headers=bob_headers).status_code in {401, 403}
    assert client.get(f"/v1/workspaces/{project_id}/channels/nonexistent/subscription",
                      headers=bob_headers).status_code == 404
    assert _post(client, project_id, bob_headers).status_code in {401, 403}  # viewer cannot post

    db.query(WorkspaceMembership).filter_by(workspace_id=project_id, user_id=bob["id"]).update({"role": "member"})
    db.commit()
    assert _post(client, project_id, bob_headers).status_code == 200
    db.expire_all()
    row = db.query(ChannelHumanMember).filter_by(channel_id=channel_id, user_email=bob["identity_key"]).one()
    assert row.following is False
    assert _post(client, project_id, alice_headers).status_code == 200
    db.expire_all()
    assert db.query(ChannelHumanMember).filter_by(channel_id=channel_id, user_email=alice["identity_key"]).one().following is True


def test_project_device_identity_and_removed_member_never_receive_push(local_auth, client, db, monkeypatch):
    alice, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    outsider, outsider_headers = _account(client, "outsider")
    project_id, channel_id = _project(client, db, alice_headers)
    _add_member(db, project_id, bob)
    assert client.post("/v1/devices/register", json={"network": project_id, "fcm_token": "machine"},
                       headers={"X-Workspace-Token": db.get(Workspace, project_id).password_hash}).status_code in {401, 403}
    assert client.post("/v1/devices/register", json={"network": project_id, "fcm_token": "outsider"},
                       headers=outsider_headers).status_code in {401, 403}
    for username, headers in (("alice", alice_headers), ("bob", bob_headers)):
        response = client.post("/v1/devices/register", headers=headers, json={
            "network": project_id, "fcm_token": username,
            "user_email": outsider["identity_key"],
        })
        assert response.status_code == 200, response.text
    db.expire_all()
    assert {row.fcm_token: row.user_email for row in db.query(DeviceToken).filter_by(workspace_id=project_id)} == {
        "alice": alice["identity_key"], "bob": bob["identity_key"],
    }
    assert client.post("/v1/devices/register", headers=bob_headers, json={
        "network": project_id, "fcm_token": "alice", "user_email": bob["identity_key"],
    }).status_code == 403
    assert client.request("DELETE", "/v1/devices/register", headers=alice_headers, json={
        "network": project_id, "fcm_token": "bob",
    }).json()["data"]["deleted"] == 0

    assert _post(client, project_id, alice_headers).status_code == 200
    sent = []
    alert_titles = []
    monkeypatch.setattr(push, "SessionLocal", sessionmaker(bind=db.get_bind()))
    def capture_push(tokens, alert, data):
        sent.append((tokens, data["reason"]))
        alert_titles.append(alert.title)
        return tokens, []
    monkeypatch.setattr(push, "send_push", capture_push)
    event = lambda content: {
        "id": "e1", "type": "workspace.message.posted", "source": "openagents:bot",
        "target": "channel/conversation", "payload": {"content": content, "message_type": "chat"},
    }
    push.fanout_for_event(project_id, event("ordinary"))
    assert sent == [(["alice"], "chat")]
    sent.clear()
    push.fanout_for_event(project_id, event("@{bob} please join"))
    assert sent == [(["bob"], "mention")]

    sent.clear()
    push.fanout_for_event(project_id, event("@{alice} and @{bob} please review"))
    assert len(sent) == 1 and set(sent[0][0]) == {"alice", "bob"}
    assert sent[0][1] == "mention"

    assert client.put(_subscription(project_id), headers=bob_headers, json={"following": True}).status_code == 200
    sent.clear()
    push.fanout_for_event(project_id, {
        "id": "human-event", "type": "workspace.message.posted",
        "source": f"human:{alice['identity_key']}", "target": "channel/conversation",
        "payload": {"content": "Project update", "message_type": "chat",
                    "sender_email": alice["identity_key"], "sender_display_name": "forged"},
    })
    assert sent == [(["bob"], "chat")]
    assert alert_titles[-1] == "alice"

    assert client.put(_subscription(project_id), headers=bob_headers, json={"following": False}).status_code == 200
    sent.clear()
    push.fanout_for_event(project_id, event("@{BOB} please review"))
    assert sent == [(["bob"], "mention")]

    removed = client.delete(f"/v1/workspaces/{project_id}/team/bob", headers=alice_headers)
    assert removed.status_code == 200, removed.text
    db.expire_all()
    assert db.query(DeviceToken).filter_by(workspace_id=project_id, user_email=bob["identity_key"]).count() == 0
    assert db.query(ChannelHumanMember).filter_by(channel_id=channel_id, user_email=bob["identity_key"]).count() == 0

    # Even stale rows left by a queued job must be filtered at send time.
    db.add(DeviceToken(workspace_id=project_id, fcm_token="stale", device_type="ios", user_email=bob["identity_key"]))
    db.add(ChannelHumanMember(channel_id=channel_id, user_email=bob["identity_key"]))
    db.commit()
    sent.clear()
    push.fanout_for_event(project_id, event("@{bob} project details"))
    assert sent == [(["alice"], "chat")]
    sent.clear()
    push.fanout_for_event(project_id, event("ordinary"))
    assert sent == [(["alice"], "chat")]
