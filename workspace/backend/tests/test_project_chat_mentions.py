"""Project-local human mentions are scoped, validated and routed before persistence."""

import pytest
from sqlalchemy import select

from app.config import config
from app.models import Channel, ChannelMember, User, WorkflowRun, WorkspaceMember
from app.services.workflow import run_advance


@pytest.fixture
def project_mode(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "project-mention-signing-key-long-enough")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")
    monkeypatch.setattr(config, "ROUTER_LLM_ENABLED", False)
    for task in (
        "app.services.push.fanout_for_event",
        "app.services.cloud_agent.invoke_cloud_agents",
        "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event",
    ):
        monkeypatch.setattr(task, lambda *_args: None)


def _account(client, name):
    result = client.post("/v1/auth/local/register", json={"username": name, "password": "simplepass"})
    assert result.status_code == 200, result.text
    return {"Authorization": f"Bearer {result.json()['data']['session_token']}"}


def _project(client, headers, name="Project"):
    response = client.post("/v1/workspaces", headers=headers, json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["data"]["workspaceId"]


def _event(client, headers, network, event_type, payload, channel="chat"):
    return client.post("/v1/events", headers=headers, json={
        "network": network, "source": "human:forged", "target": f"channel/{channel}",
        "type": event_type, "payload": payload,
    })


def _message(client, headers, network, content, channel="chat"):
    return _event(client, headers, network, "workspace.message.posted", {"content": content}, channel)


def _channel(client, headers, network, agents=(), master=None, channel="chat"):
    payload = {"name": channel, "title": "Conversation", "participants": list(agents)}
    if master:
        payload["master"] = master
    response = _event(client, headers, network, "network.channel.create", payload, channel)
    assert response.status_code == 200, response.text


def _agent(db, network, name, *, status="online", agent_type="cloud:openai"):
    db.add(WorkspaceMember(workspace_id=network, agent_name=name, status=status, agent_type=agent_type))
    db.commit()


def _event_contents(client, headers, network, channel="chat"):
    response = client.get("/v1/events", headers=headers, params={
        "network": network, "channel": channel, "type": "workspace.message.posted",
    })
    assert response.status_code == 200, response.text
    return [event["payload"]["content"] for event in response.json()["data"]["events"]]


def test_human_mentions_are_validated_with_current_project_membership(project_mode, client, db):
    alice = _account(client, "alice")
    bob = _account(client, "bob")
    _account(client, "outsider")
    project = _project(client, alice)
    _agent(db, project, "bob")  # agent identity and username are distinct
    _channel(client, alice, project, ["bob"], master="bob")

    invite = client.post(f"/v1/workspaces/{project}/invites", headers=alice,
                         json={"username": "bob", "role": "member"})
    token = invite.json()["data"]["url"].rsplit("/", 1)[-1]
    assert client.post(f"/v1/invites/{token}/accept", headers=bob).status_code == 200
    # Legacy rows may predate the normalized-username write policy.
    bob_row = db.execute(select(User).where(User.username == "bob")).scalar_one()
    bob_row.username = "BoB"
    db.commit()

    human_only = _message(client, alice, project, "Please review @{BOB}")
    assert human_only.status_code == 200, human_only.text
    assert human_only.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]

    mixed = _message(client, alice, project, "@bob and @{bob} please review")
    assert mixed.status_code == 200, mixed.text
    assert mixed.json()["data"]["metadata"]["target_agents"] == ["bob"]

    before = _event_contents(client, bob, project)
    for content in ("@{outsider} should not be notified", "@{removed-user} test"):
        rejected = _message(client, alice, project, content)
        assert rejected.status_code == 400, rejected.text
        assert "project_mention_member_not_found" in rejected.text
        assert _event_contents(client, bob, project) == before

    removed = client.delete(f"/v1/workspaces/{project}/team/{bob_row.id}", headers=alice)
    assert removed.status_code == 200, removed.text
    rejected = _message(client, alice, project, "@{bob} has left")
    assert rejected.status_code == 400, rejected.text
    assert "project_mention_member_not_found" in rejected.text
    assert _event_contents(client, alice, project) == before


def test_first_joined_agent_wins_and_unjoined_or_offline_agent_is_rejected(project_mode, client, db, monkeypatch):
    alice = _account(client, "alice")
    project = _project(client, alice)
    for name in ("master", "helper", "reserve"):
        _agent(db, project, name)
    _agent(db, project, "yumi", agent_type="cloud:openagents")
    _channel(client, alice, project, ["master", "helper"], master="master")
    changed = client.patch(f"/v1/workspaces/{project}/channels/chat", headers=alice,
                           json={"orchestration_mode": "master"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["orchestrationMode"] == "master"

    first = _message(client, alice, project, "Let's ask @helper, then @master")
    assert first.status_code == 200, first.text
    assert first.json()["data"]["metadata"]["target_agents"] == ["helper"]

    changed = client.patch(f"/v1/workspaces/{project}/channels/chat", headers=alice,
                           json={"orchestration_mode": "dynamic"})
    assert changed.status_code == 200
    monkeypatch.setattr(config, "ROUTER_LLM_ENABLED", True)
    monkeypatch.setattr("app.mods.workspace_mod._get_router_api_key", lambda: "present")

    async def unexpected_router(*_args, **_kwargs):
        raise AssertionError("explicit project mention must bypass the dynamic LLM router")

    monkeypatch.setattr("app.mods.workspace_mod._route_with_llm", unexpected_router)
    dynamic = _message(client, alice, project, "@helper handles this in dynamic mode")
    assert dynamic.status_code == 200, dynamic.text
    assert dynamic.json()["data"]["metadata"]["target_agents"] == ["helper"]
    monkeypatch.setattr(config, "ROUTER_LLM_ENABLED", False)

    before = _event_contents(client, alice, project)
    for name in ("reserve", "yumi"):
        rejected = _message(client, alice, project, f"@{name} join by text")
        assert rejected.status_code == 400, rejected.text
        assert "project_mention_agent_not_joined" in rejected.text
        assert _event_contents(client, alice, project) == before

    joined = _event(client, alice, project, "network.channel.join", {"channel": "chat", "agent_name": "yumi"})
    assert joined.status_code == 200, joined.text
    yumi = _message(client, alice, project, "@yumi now deliberately joined")
    assert yumi.status_code == 200, yumi.text
    assert yumi.json()["data"]["metadata"]["target_agents"] == ["yumi"]

    member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == project,
                                                   WorkspaceMember.agent_name == "helper")).scalar_one()
    member.status = "offline"
    db.commit()
    offline = _message(client, alice, project, "@helper are you there?")
    assert offline.status_code == 400, offline.text
    assert "project_mention_agent_offline" in offline.text
    assert "@helper are you there?" not in _event_contents(client, alice, project)


def test_project_agent_name_with_spaces_unicode_and_punctuation(project_mode, client, db):
    alice = _account(client, "alice")
    project = _project(client, alice)
    _agent(db, project, "研讨 Agent")
    _agent(db, project, "研讨 Agent.v2")
    _channel(client, alice, project, ["研讨 Agent", "研讨 Agent.v2"], master="研讨 Agent")

    exact = _message(client, alice, project, "@研讨 Agent.v2 please take this")
    assert exact.status_code == 200, exact.text
    assert exact.json()["data"]["metadata"]["target_agents"] == ["研讨 Agent.v2"]
    other = _message(client, alice, project, "@研讨 Agent then verify")
    assert other.status_code == 200, other.text
    assert other.json()["data"]["metadata"]["target_agents"] == ["研讨 Agent"]


def test_workflow_step_is_only_allowed_agent_and_details_are_project_scoped(project_mode, client, db):
    alice = _account(client, "alice")
    outsider = _account(client, "outsider")
    project = _project(client, alice)
    other_project = _project(client, alice, "Other")
    for name in ("step", "other"):
        _agent(db, project, name)
    _channel(client, alice, project, ["step", "other"])
    _channel(client, alice, other_project, channel="chat")

    ch = db.execute(select(Channel).where(Channel.workspace_id == project, Channel.name == "chat")).scalar_one()
    db.add(WorkflowRun(workspace_id=project, channel_name=ch.name,
                       current_step="a", status="running", snapshot={
                           "steps": [{"id": "a", "assignee": {"kind": "agent", "agent": "step"}},
                                     {"id": "b", "assignee": {"kind": "human", "human": "alice"}}],
                       }))
    db.commit()

    detail = client.get(f"/v1/workspaces/{project}/channels/chat", headers=alice)
    assert detail.json()["data"]["workflowRunning"] is True
    assert detail.json()["data"]["activeWorkflowStepAgent"] == "step"
    assert client.get(f"/v1/workspaces/{project}/channels/chat", headers=outsider).status_code in {401, 403}
    unrelated = client.get(f"/v1/workspaces/{other_project}/channels/chat", headers=alice)
    assert unrelated.json()["data"]["workflowRunning"] is False
    assert unrelated.json()["data"]["activeWorkflowStepAgent"] is None

    rejected = _message(client, alice, project, "@other bypass step")
    assert rejected.status_code == 400, rejected.text
    assert "project_workflow_step_agent_only" in rejected.text
    assert not _event_contents(client, alice, project)
    step = _message(client, alice, project, "@step please continue")
    assert step.status_code == 200, step.text
    assert step.json()["data"]["metadata"]["target_agents"] == ["step"]

    run = db.execute(select(WorkflowRun).where(WorkflowRun.workspace_id == project)).scalar_one()
    run.current_step = "b"
    db.commit()
    detail = client.get(f"/v1/workspaces/{project}/channels/chat", headers=alice)
    assert detail.json()["data"]["activeWorkflowStepAgent"] is None
    assert _message(client, alice, project, "@step bypass human step").status_code == 400


def test_project_human_mention_does_not_advance_human_workflow_step(project_mode, client, db):
    alice = _account(client, "alice")
    bob = _account(client, "bob")
    project = _project(client, alice)
    invitation = client.post(f"/v1/workspaces/{project}/invites", headers=alice,
                             json={"username": "bob", "role": "member"})
    token = invitation.json()["data"]["url"].rsplit("/", 1)[-1]
    assert client.post(f"/v1/invites/{token}/accept", headers=bob).status_code == 200
    _channel(client, alice, project)
    run = WorkflowRun(workspace_id=project, channel_name="chat", current_step="review",
                      status="running", snapshot={"steps": [{
                          "id": "review", "assignee": {"kind": "human", "human": "alice"},
                      }]})
    db.add(run)
    db.commit()
    human_message = _message(client, alice, project, "@{bob} can you review?")
    assert human_message.status_code == 200, human_message.text
    assert human_message.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]
    assert run_advance(db, project, {"target": "channel/chat", "source": human_message.json()["data"]["source"],
                                     "payload": {"content": "@{bob} can you review?"}}) is False
    db.refresh(run)
    assert run.current_step == "review"


def test_leaving_master_reassigns_or_clears_project_channel(project_mode, client, db):
    alice = _account(client, "alice")
    project = _project(client, alice)
    for name in ("lead", "other"):
        _agent(db, project, name)
    _channel(client, alice, project, ["lead", "other"], master="lead")
    for name, expected in (("lead", "other"), ("other", None)):
        left = _event(client, alice, project, "network.channel.leave", {"channel": "chat", "agent_name": name})
        assert left.status_code == 200, left.text
        detail = client.get(f"/v1/workspaces/{project}/channels/chat", headers=alice)
        assert detail.json()["data"]["masterAgent"] == expected


def test_project_agent_removal_cleans_channel_memberships_and_master(project_mode, client, db):
    alice = _account(client, "alice")
    project = _project(client, alice)
    for name in ("lead", "other", "third"):
        _agent(db, project, name)
    _channel(client, alice, project, ["lead", "other"], master="lead")
    lead = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == project,
                                                 WorkspaceMember.agent_name == "lead")).scalar_one()
    lead.role = "master"
    db.commit()

    removed = _event(client, alice, project, "network.agent.remove", {"agent_name": "lead"})
    assert removed.status_code == 200, removed.text
    detail = client.get(f"/v1/workspaces/{project}/channels/chat", headers=alice).json()["data"]
    assert detail["masterAgent"] == "other"
    assert detail["participants"] == ["other"]
    rejected = _message(client, alice, project, "@lead should no longer receive this")
    assert rejected.status_code == 400, rejected.text
    assert "project_mention_agent_not_joined" in rejected.text


def test_personal_channel_keeps_legacy_mention_autojoin(project_mode, client, db):
    alice = _account(client, "alice")
    personal = client.get("/v1/account/personal-space", headers=alice)
    assert personal.status_code == 200, personal.text
    network = personal.json()["data"]["workspaceId"]
    _agent(db, network, "helper")
    _channel(client, alice, network)
    response = _message(client, alice, network, "@helper please help")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["helper"]
    channel = db.execute(select(Channel).where(Channel.workspace_id == network, Channel.name == "chat")).scalar_one()
    assert db.execute(select(ChannelMember).where(ChannelMember.channel_id == channel.id,
                                                  ChannelMember.agent_name == "helper")).scalar_one_or_none()


def test_project_task_channel_keeps_existing_agent_kickoff_routing(project_mode, client, db):
    alice = _account(client, "alice")
    project = _project(client, alice)
    _agent(db, project, "assignee", status="offline")
    _channel(client, alice, project, channel="task:example")

    kickoff = _message(client, alice, project, "@assignee do the task", channel="task:example")
    assert kickoff.status_code == 200, kickoff.text
    assert kickoff.json()["data"]["metadata"]["target_agents"] == ["assignee"]
    channel = db.execute(select(Channel).where(Channel.workspace_id == project,
                                               Channel.name == "task:example")).scalar_one()
    assert db.execute(select(ChannelMember).where(ChannelMember.channel_id == channel.id,
                                                  ChannelMember.agent_name == "assignee")).scalar_one_or_none()
