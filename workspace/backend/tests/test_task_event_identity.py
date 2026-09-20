"""Project task comments must use the human's authenticated account identity."""

import pytest
from sqlalchemy import select

from app.config import config
from app.models import Channel, EventRecord, KanbanTask, User, Workspace


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "task-event-test-signing-key")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def test_machine_token_cannot_impersonate_task_owner(local_auth, client, db):
    registered = client.post("/v1/auth/local/register", json={
        "username": "taskowner", "password": "simplepass",
    }).json()["data"]
    bearer = {"Authorization": f"Bearer {registered['session_token']}"}
    response = client.post("/v1/workspaces", headers=bearer, json={"name": "Task project"})
    assert response.status_code == 200, response.text
    project_id = response.json()["data"]["workspaceId"]
    owner = db.execute(select(User).where(User.username == "taskowner")).scalar_one()
    task = KanbanTask(
        workspace_id=project_id, title="Review", description="", created_by=f"human:{owner.email}",
        responsible_user_id=owner.id, status="in_progress", execution_status="idle",
        channel_name="task:identity-check",
    )
    db.add_all([task, Channel(workspace_id=project_id, name=task.channel_name, title=task.title)])
    db.commit()

    request = {
        "network": project_id, "source": f"human:{owner.email}",
        "type": "workspace.message.posted", "target": f"channel/{task.channel_name}",
        "payload": {"content": "Task owner update"},
        "metadata": {"task_kickoff": True},
    }
    machine_token = db.get(Workspace, project_id).password_hash
    forged = client.post("/v1/events", headers={"X-Workspace-Token": machine_token}, json=request)
    assert forged.status_code == 403
    assert db.execute(select(EventRecord).where(EventRecord.target == request["target"])).first() is None

    authenticated = client.post("/v1/events", headers=bearer, json=request)
    assert authenticated.status_code == 200, authenticated.text
    assert authenticated.json()["data"]["source"] == f"human:{owner.email}"
    assert "task_kickoff" not in authenticated.json()["data"]["metadata"]
