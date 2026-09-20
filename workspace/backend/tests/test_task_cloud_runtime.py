"""Cloud-backed project member tasks reuse the project channel event pipeline."""

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.config import config
from app.models import Channel, CloudAgentConfig, EventRecord, KanbanTask, WorkspaceMember, WorkspaceMembership
from app.services import cloud_agent


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "task-cloud-test-signing-key")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def _account(client, username):
    response = client.post("/v1/auth/local/register", json={
        "username": username, "password": "simplepass",
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _member_task(client, db, *, cloud=True):
    _, admin_headers = _account(client, "taskadmin")
    owner, owner_headers = _account(client, "taskowner")
    response = client.post("/v1/workspaces", headers=admin_headers, json={"name": "Agent task project"})
    assert response.status_code == 200, response.text
    project = response.json()["data"]["workspaceId"]
    db.add(WorkspaceMembership(workspace_id=project, user_id=owner["id"], role="member"))
    db.add(WorkspaceMember(
        workspace_id=project, agent_name="helper", status="online",
        agent_type="cloud:deepseek" if cloud else "daemon",
    ))
    if cloud:
        db.add(CloudAgentConfig(
            workspace_id=project, agent_name="helper", provider="deepseek", model="deepseek-v4-pro",
            category="chat", api_key="test-only", status="active",
        ))
    db.commit()
    plan = client.post(f"/v1/workspaces/{project}/plan-items", headers=admin_headers, json={
        "title": "Deliver release", "description": "Ship the checklist", "status": "todo",
    })
    assert plan.status_code == 200, plan.text
    dispatched = client.post(
        f"/v1/workspaces/{project}/plan-items/{plan.json()['data']['id']}/dispatch",
        headers=admin_headers,
        json={"version": plan.json()["data"]["version"], "userIds": [owner["id"]]},
    )
    assert dispatched.status_code == 200, dispatched.text
    task_id = dispatched.json()["data"]["tasks"][0]["id"]
    url = f"/v1/tasks/{task_id}"
    configured = client.post(f"{url}/configure", headers=owner_headers, json={
        "network": project, "mode": "agent", "agent": "helper",
    })
    assert configured.status_code == 200, configured.text
    assert client.post(f"{url}/accept", headers=owner_headers,
                       json={"network": project}).status_code == 200
    return project, task_id, owner_headers, admin_headers


def _run(client, project, task_id, headers):
    return client.post(f"/v1/tasks/{task_id}/assign", headers=headers, json={"network": project})


def _events(db, project, task_id):
    return db.execute(select(EventRecord).where(
        EventRecord.network_id == project,
        EventRecord.target == f"channel/task:{task_id}",
        EventRecord.type == "workspace.message.posted",
    ).order_by(EventRecord.timestamp)).scalars().all()


def test_cloud_kickoff_invokes_once_with_persisted_event_and_run(local_auth, client, db, monkeypatch):
    project, task_id, owner, _ = _member_task(client, db)
    snapshots = []

    async def capture(_project, event):
        snapshots.append(event)

    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", capture)
    first = _run(client, project, task_id, owner)
    assert first.status_code == 200, first.text
    run_id = first.json()["data"]["active_run_id"]
    kickoff = _events(db, project, task_id)[0]
    assert run_id and kickoff.metadata_["task_run_id"] == run_id
    assert len(snapshots) == 1
    assert snapshots[0]["id"] == kickoff.id
    assert snapshots[0]["metadata"]["target_agents"] == ["helper"]
    assert _run(client, project, task_id, owner).status_code == 200
    assert len(snapshots) == 1
    assert len([e for e in _events(db, project, task_id) if (e.metadata_ or {}).get("target_agents") == ["helper"]]) == 1


def test_another_project_member_reads_reply_but_cannot_wake_task_agent(local_auth, client, db, monkeypatch):
    from app.mods import workspace_mod

    project, task_id, owner, _ = _member_task(client, db)
    member, member_headers = _account(client, "taskobserver")
    _, outsider_headers = _account(client, "taskoutsider")
    db.add(WorkspaceMembership(workspace_id=project, user_id=member["id"], role="member"))
    db.commit()
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())
    monkeypatch.setattr(cloud_agent, "SessionLocal", sessions)
    monkeypatch.setattr(workspace_mod, "_classify_task_progress", lambda *_args: "running")

    async def reply(**_kwargs):
        return "Shared task result"

    monkeypatch.setattr(cloud_agent, "chat_completion", reply)
    started = _run(client, project, task_id, owner)
    assert started.status_code == 200, started.text
    channel = f"task:{task_id}"
    events_url = "/v1/events"
    params = {"network": project, "channel": channel, "type": "workspace.message", "sort": "asc"}
    shared = client.get(events_url, params=params, headers=member_headers)
    assert shared.status_code == 200, shared.text
    events = shared.json()["data"]["events"]
    assert len(events) == 2
    assert events[1]["source"] == "openagents:helper"
    assert events[1]["payload"]["content"] == "Shared task result"

    comment = client.post(events_url, headers=member_headers, json={
        "network": project, "source": "human:forged", "type": "workspace.message.posted",
        "target": f"channel/{channel}", "payload": {"content": "@helper run again"},
    })
    assert comment.status_code == 200, comment.text
    assert comment.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]
    assert len(_events(db, project, task_id)) == 3
    assert client.get(events_url, params=params, headers=outsider_headers).status_code in {401, 403}


def test_disabled_cloud_config_rejected_before_kickoff(local_auth, client, db):
    project, task_id, owner, _ = _member_task(client, db)
    cfg = db.execute(select(CloudAgentConfig).where(
        CloudAgentConfig.workspace_id == project,
        CloudAgentConfig.agent_name == "helper",
    )).scalar_one()
    cfg.status = "disabled"
    db.commit()
    rejected = _run(client, project, task_id, owner)
    assert rejected.status_code == 409, rejected.text
    assert db.get(KanbanTask, task_id).active_run_id is None
    assert _events(db, project, task_id) == []


def test_kickoff_rejection_rolls_back_channel_and_run(local_auth, client, db, monkeypatch):
    from app.routers import tasks

    project, task_id, owner, _ = _member_task(client, db)
    existing = db.execute(select(Channel).where(
        Channel.workspace_id == project, Channel.name == f"task:{task_id}",
    )).scalar_one()
    original_master = existing.master_agent
    original_emit = tasks._emit_event_blocking

    def reject_kickoff(event, *args, **kwargs):
        if event.type == "workspace.message.posted":
            return None
        return original_emit(event, *args, **kwargs)

    monkeypatch.setattr(tasks, "_emit_event_blocking", reject_kickoff)
    rejected = _run(client, project, task_id, owner)
    assert rejected.status_code == 403, rejected.text
    db.refresh(existing)
    task = db.get(KanbanTask, task_id)
    db.refresh(task)
    assert task.active_run_id is None and task.execution_status == "idle"
    assert existing.master_agent == original_master
    assert _events(db, project, task_id) == []


def test_new_channel_is_not_left_behind_when_kickoff_fails(local_auth, client, db, monkeypatch):
    from app.routers import tasks

    project, _, _, admin = _member_task(client, db)
    created = client.post("/v1/tasks", headers=admin, json={
        "network": project, "title": "Standalone agent work", "assignee": "helper",
    })
    assert created.status_code == 200, created.text
    task_id = created.json()["data"]["id"]
    original_emit = tasks._emit_event_blocking

    def reject_kickoff(event, *args, **kwargs):
        if event.type == "workspace.message.posted":
            return None
        return original_emit(event, *args, **kwargs)

    monkeypatch.setattr(tasks, "_emit_event_blocking", reject_kickoff)
    failed = _run(client, project, task_id, admin)
    assert failed.status_code == 403, failed.text
    db.expire_all()
    row = db.get(KanbanTask, task_id)
    assert row.status == "backlog" and row.channel_name is None
    assert db.execute(select(Channel.id).where(
        Channel.workspace_id == project, Channel.name == f"task:{task_id}",
    )).first() is None
    assert db.execute(select(EventRecord.id).where(
        EventRecord.network_id == project, EventRecord.target == f"channel/task:{task_id}",
    )).first() is None


def test_daemon_kickoff_uses_channel_without_cloud_invocation(local_auth, client, db, monkeypatch):
    project, task_id, owner, _ = _member_task(client, db, cloud=False)
    calls = []

    async def capture(_project, event):
        calls.append(event)

    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", capture)
    started = _run(client, project, task_id, owner)
    assert started.status_code == 200, started.text
    assert calls == []
    kickoff = next(e for e in _events(db, project, task_id) if (e.metadata_ or {}).get("target_agents") == ["helper"])
    assert kickoff.metadata_["task_run_id"] == started.json()["data"]["active_run_id"]
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == project, Channel.name == f"task:{task_id}",
    )).scalar_one()
    assert "helper" in {member.agent_name for member in channel.participants}


@pytest.mark.parametrize("empty_response", [False, True])
def test_cloud_response_and_failure_keep_run_identity(local_auth, client, db, monkeypatch, empty_response):
    from app.mods import workspace_mod
    from app.services import integrations, push, workflow

    project, task_id, owner, _ = _member_task(client, db)
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())
    monkeypatch.setattr(cloud_agent, "SessionLocal", sessions)
    monkeypatch.setattr(workspace_mod, "_classify_task_progress", lambda *_args: "running")
    monkeypatch.setattr(push, "fanout_for_event", lambda *_args: None)
    monkeypatch.setattr(integrations, "relay_for_event", lambda *_args: None)
    monkeypatch.setattr(workflow, "advance_workflow", lambda *_args: None)

    async def reply(**_kwargs):
        return "Checklist ready"

    monkeypatch.setattr(cloud_agent, "chat_completion", reply)
    started = _run(client, project, task_id, owner)
    assert started.status_code == 200, started.text
    run_id = started.json()["data"]["active_run_id"]
    messages = _events(db, project, task_id)
    assert len(messages) == 2
    assert messages[-1].source == "openagents:helper"
    assert messages[-1].metadata_["task_run_id"] == run_id
    assert db.get(KanbanTask, task_id).execution_status == "running"

    async def broken(**_kwargs):
        if empty_response:
            return ""
        raise RuntimeError("Provider unavailable")

    monkeypatch.setattr(cloud_agent, "chat_completion", broken)
    assert client.post(f"/v1/tasks/{task_id}/stop", headers=owner,
                       json={"network": project}).status_code == 200
    resumed = _run(client, project, task_id, owner)
    assert resumed.status_code == 200, resumed.text
    failure = _events(db, project, task_id)[-1]
    assert failure.metadata_["status_kind"] == "failed"
    assert failure.metadata_["task_run_id"] == resumed.json()["data"]["active_run_id"]
    db.expire_all()
    task = db.get(KanbanTask, task_id)
    assert task.execution_status == "paused" and task.active_run_id is None


def test_stopped_or_restarted_run_drops_late_cloud_response(local_auth, client, db, monkeypatch):
    project, task_id, owner, _ = _member_task(client, db)
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())
    monkeypatch.setattr(cloud_agent, "SessionLocal", sessions)

    async def capture(_project, _event):
        pass

    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", capture)
    first = _run(client, project, task_id, owner).json()["data"]
    run_id = first["active_run_id"]
    target = f"channel/task:{task_id}"
    stop = client.post(f"/v1/tasks/{task_id}/stop", headers=owner, json={"network": project})
    assert stop.status_code == 200, stop.text
    before = len(_events(db, project, task_id))
    with sessions() as session:
        asyncio.run(cloud_agent._post_response(session, project, target, "helper", "Too late", 0,
                                               task_run_id=run_id))
    assert len(_events(db, project, task_id)) == before
    second = _run(client, project, task_id, owner).json()["data"]
    assert second["active_run_id"] != run_id
    with sessions() as session:
        asyncio.run(cloud_agent._post_response(session, project, target, "helper", "Old result", 0,
                                               task_run_id=run_id))
    assert len(_events(db, project, task_id)) == before + 1  # only the new kickoff


def test_unassigned_project_task_idempotency_preserves_admin_gate(local_auth, client, db):
    project, task_id, owner, admin = _member_task(client, db, cloud=False)
    task = db.get(KanbanTask, task_id)
    task.responsible_user_id = None
    task.status = "backlog"
    db.commit()
    denied = _run(client, project, task_id, owner)
    assert denied.status_code == 403, denied.text
    allowed = _run(client, project, task_id, admin)
    assert allowed.status_code == 200, allowed.text
    assert len([e for e in _events(db, project, task_id) if (e.metadata_ or {}).get("target_agents") == ["helper"]]) == 1
    assert _run(client, project, task_id, owner).status_code == 403
    assert _run(client, project, task_id, admin).status_code == 200
    assert len([e for e in _events(db, project, task_id) if (e.metadata_ or {}).get("target_agents") == ["helper"]]) == 1
