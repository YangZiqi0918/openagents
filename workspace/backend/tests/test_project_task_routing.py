"""Project task threads route only to the assigned execution agent."""

import asyncio

import pytest
from sqlalchemy import select

from app.config import config
from app.models import (
    Channel, ChannelMember, EventRecord, KanbanTask, WorkflowRun, Workspace,
    WorkspaceMember, WorkspaceMembership,
)
from app.mods import workspace_mod
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "task-routing-test-signing-key-unique")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")
    for hook in (
        "app.services.push.fanout_for_event",
        "app.services.cloud_agent.invoke_cloud_agents",
        "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event",
    ):
        monkeypatch.setattr(hook, lambda *_args: None)


def _account(client, username):
    response = client.post("/v1/auth/local/register", json={"username": username, "password": "simplepass"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _task(client, db):
    admin, admin_headers = _account(client, "task-admin")
    owner, owner_headers = _account(client, "task-owner")
    commenter, commenter_headers = _account(client, "task-commenter")
    response = client.post("/v1/workspaces", headers=admin_headers, json={"name": "Execution project"})
    assert response.status_code == 200, response.text
    project_id = response.json()["data"]["workspaceId"]
    db.add_all([
        WorkspaceMembership(workspace_id=project_id, user_id=owner["id"], role="member"),
        WorkspaceMembership(workspace_id=project_id, user_id=commenter["id"], role="member"),
    ])
    db.add_all([
        WorkspaceMember(workspace_id=project_id, agent_name=name, agent_type="cloud:test", status="online")
        for name in ("agent-alpha", "agent-beta")
    ])
    task = KanbanTask(
        id="task-routing-1", workspace_id=project_id, title="Review release",
        created_by=f"human:{admin['identity_key']}", responsible_user_id=owner["id"],
        status="in_progress", assignee="agent-alpha", execution_status="running",
        active_run_id="run-1", channel_name="task:task-routing-1",
    )
    channel = Channel(workspace_id=project_id, name=task.channel_name, title=task.title,
                      master_agent="agent-beta")
    db.add_all([task, channel])
    db.flush()
    db.add_all([
        ChannelMember(channel_id=channel.id, agent_name=name)
        for name in ("agent-alpha", "agent-beta")
    ])
    db.commit()
    return db.get(Workspace, project_id), task, (admin, admin_headers), (
        owner, owner_headers), (commenter, commenter_headers)


def _post(client, workspace, task, headers, content, metadata=None):
    return client.post("/v1/events", headers=headers, json={
        "network": workspace.id, "type": "workspace.message.posted",
        "source": "human:forged", "target": f"channel/{task.channel_name}",
        "payload": {"content": content, "message_type": "chat"},
        "metadata": metadata or {},
    })


def test_task_owner_targets_only_configured_agent_and_other_member_only_comments(
    local_auth, client, db,
):
    workspace, task, _, (_, owner_headers), (_, commenter_headers) = _task(client, db)
    response = _post(client, workspace, task, owner_headers, "How is it going?",
                     {"target_agents": ["agent-beta"], "task_run_id": "forged"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["agent-alpha"]
    assert response.json()["data"]["metadata"]["task_run_id"] == "run-1"

    response = _post(client, workspace, task, owner_headers, "@agent-beta Do this instead")
    assert response.status_code == 400, response.text
    assert response.json()["message"].startswith("project_mention_task_agent_only")
    response = _post(client, workspace, task, owner_headers, "@agent-alpha Continue")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["agent-alpha"]

    response = _post(client, workspace, task, commenter_headers, "@agent-alpha Work on this",
                     {"target_agents": ["agent-alpha"]})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["task_comment"] is True
    assert response.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]


def test_idle_or_paused_owner_mention_cannot_start_run(local_auth, client, db):
    workspace, task, _, (_, owner_headers), _ = _task(client, db)
    task.active_run_id = None
    task.execution_status = "paused"
    db.commit()

    response = _post(client, workspace, task, owner_headers, "@agent-alpha Please run")
    assert response.status_code == 400, response.text
    assert response.json()["message"] == "project_mention_task_not_running"
    response = _post(client, workspace, task, owner_headers, "A note for the task")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]
    assert "task_run_id" not in response.json()["data"]["metadata"]


def test_workflow_task_only_targets_current_agent_step(local_auth, client, db):
    workspace, task, _, (_, owner_headers), _ = _task(client, db)
    task.workflow_id = "task-workflow"
    run = WorkflowRun(
        workspace_id=workspace.id, workflow_id=task.workflow_id,
        channel_name=task.channel_name, current_step="agent", status="running",
        snapshot={"steps": [
            {"id": "agent", "assignee": {"kind": "agent", "agent": "agent-beta"}},
            {"id": "human", "assignee": {"kind": "human", "human": "task-owner"}},
        ]},
    )
    db.add(run)
    db.commit()

    response = _post(client, workspace, task, owner_headers, "@agent-alpha Please run")
    assert response.status_code == 400, response.text
    response = _post(client, workspace, task, owner_headers, "Step status?")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["agent-beta"]
    response = _post(client, workspace, task, owner_headers, "@agent-beta Step status?")
    assert response.status_code == 200, response.text

    run.current_step = "human"
    db.commit()
    response = _post(client, workspace, task, owner_headers, "I will review this")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["metadata"]["target_agents"] == ["__no_response__"]
    response = _post(client, workspace, task, owner_headers, "@agent-beta Ignore the review")
    assert response.status_code == 400, response.text


def test_stale_cloud_output_rejected_before_persistence(local_auth, client, db):
    workspace, task, _, _, _ = _task(client, db)
    def post(run_id, message_type="chat", source="openagents:agent-alpha"):
        return client.post("/v1/events", headers={"X-Workspace-Token": workspace.password_hash}, json={
            "network": workspace.id, "type": "workspace.message.posted",
            "source": source, "target": f"channel/{task.channel_name}",
            "payload": {"content": "Late output", "message_type": message_type},
            "metadata": {"task_run_id": run_id},
        })

    assert post("old-run", "thinking").status_code != 200
    assert post("run-1", source="openagents:agent-beta").status_code != 200
    task.active_run_id = None
    task.execution_status = "paused"
    db.commit()
    assert post("run-1").status_code != 200
    assert db.execute(select(EventRecord).where(
        EventRecord.network_id == workspace.id,
        EventRecord.target == f"channel/{task.channel_name}",
    )).scalars().all() == []


def test_internal_admin_kickoff_is_not_treated_as_comment(local_auth, client, db):
    workspace, task, (admin, admin_headers), _, _ = _task(client, db)
    source = f"human:{admin['identity_key']}"
    event = Event(
        type="workspace.message.posted", source=source,
        target=f"channel/{task.channel_name}", payload={"content": "@agent-alpha Start"},
        metadata={"task_kickoff": True, "task_run_id": "run-1", "target_agents": ["agent-beta"]},
    )
    ctx = PipelineContext(
        network_id=workspace.id, agent_address=source, db=db, workspace=workspace,
        bearer_token=admin_headers["Authorization"].split()[1],
    )
    routed = asyncio.run(workspace_mod._handle_message_posted(event, ctx))
    assert routed.metadata["target_agents"] == ["agent-alpha"]
    assert routed.metadata["task_run_id"] == "run-1"
    assert "task_comment" not in routed.metadata
