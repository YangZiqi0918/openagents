"""Human-owned plans dispatch into independent, review-gated personal tasks."""

import pytest
from sqlalchemy import select

from app.config import config
from app.models import Channel, EventRecord, KanbanTask, Workflow, WorkflowRun, Workspace, WorkspaceMember, WorkspaceMembership


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "plan-dispatch-test-signing-key")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def _account(client, username):
    response = client.post("/v1/auth/local/register", json={"username": username, "password": "simplepass"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _project(client, headers):
    response = client.post("/v1/workspaces", headers=headers, json={"name": "Personal plan"})
    assert response.status_code == 200, response.text
    return response.json()["data"]["workspaceId"]


def _member(db, project, user, role="member"):
    db.add(WorkspaceMembership(workspace_id=project, user_id=user["id"], role=role))
    db.commit()


def _setup(client, db):
    owner, admin = _account(client, "planner")
    alice, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    project = _project(client, admin)
    _member(db, project, alice)
    _member(db, project, bob)
    return project, (owner, admin), (alice, alice_headers), (bob, bob_headers)


def _plan(client, project, admin):
    response = client.post(f"/v1/workspaces/{project}/plan-items", headers=admin,
                           json={"title": "Prepare release", "description": "Check the deployment",
                                 "status": "todo", "priority": "high", "tags": ["release"],
                                 "acceptanceCriteria": "Checklist attached"})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _dispatch(client, project, item, admin, user_ids):
    return client.post(f"/v1/workspaces/{project}/plan-items/{item['id']}/dispatch",
                       headers=admin, json={"version": item["version"], "userIds": user_ids})


def test_admin_dispatch_is_idempotent_and_each_member_accepts_independently(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (bob, bob_headers) = _setup(client, db)
    item = _plan(client, project, admin)
    assert client.get(f"/v1/workspaces/{project}/plan-items", headers=alice_headers).json()["data"]["items"][0]["id"] == item["id"]
    assert _dispatch(client, project, item, alice_headers, [alice["id"]]).status_code == 403
    sent = _dispatch(client, project, item, admin, [alice["id"], bob["id"]])
    assert sent.status_code == 200, sent.text
    tasks = sent.json()["data"]["tasks"]
    again = _dispatch(client, project, item, admin, [alice["id"], bob["id"]])
    assert [t["id"] for t in again.json()["data"]["tasks"]] == [t["id"] for t in tasks]
    assert tasks[0]["id"] != tasks[1]["id"]
    assert all(t["status"] == "backlog" and t["execution_status"] == "idle" for t in tasks)
    assert all(t["channel_name"] == f"task:{t['id']}" for t in tasks)
    assert db.execute(select(Channel).where(Channel.workspace_id == project, Channel.name == tasks[0]["channel_name"])).scalar_one()

    alice_tasks = client.get("/v1/tasks", headers=alice_headers, params={"network": project}).json()["data"]["tasks"]
    bob_tasks = client.get("/v1/tasks", headers=bob_headers, params={"network": project}).json()["data"]["tasks"]
    assert {t["id"] for t in alice_tasks if t["responsible_user_id"]} == {tasks[0]["id"]}
    assert {t["id"] for t in bob_tasks if t["responsible_user_id"]} == {tasks[1]["id"]}
    assert client.get(f"/v1/tasks/{tasks[1]['id']}", headers=alice_headers,
                      params={"network": project}).status_code == 200
    assert client.post(f"/v1/tasks/{tasks[1]['id']}/accept", headers=alice_headers,
                       json={"network": project}).status_code == 403

    accepted = client.post(f"/v1/tasks/{tasks[0]['id']}/accept", headers=alice_headers,
                           json={"network": project})
    assert accepted.status_code == 200
    assert accepted.json()["data"]["status"] == "in_progress"
    assert accepted.json()["data"]["active_run_id"] is None
    kickoff = db.execute(select(EventRecord).where(EventRecord.target == f"channel/{tasks[0]['channel_name']}")).scalars().all()
    assert not kickoff  # acceptance does not start any agent
    state = client.get(f"/v1/workspaces/{project}/plan-items", headers=admin).json()["data"]["items"][0]
    assert state["status"] == "doing"
    assert {t["responsibleUserId"]: t["status"] for t in state["tasks"]} == {
        alice["id"]: "in_progress", bob["id"]: "backlog",
    }


def test_submit_for_review_cannot_be_bypassed_and_history_survives_handoff(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (bob, bob_headers) = _setup(client, db)
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    path = f"/v1/tasks/{task['id']}"
    assert client.post(f"{path}/accept", headers=alice_headers, json={"network": project}).status_code == 200
    submitted = client.post(f"{path}/submit", headers=alice_headers,
                            json={"network": project, "summary": "Deployment verified"})
    assert submitted.status_code == 200, submitted.text
    payload = submitted.json()["data"]
    assert payload["status"] == "need_input" and payload["submitted_summary"] == "Deployment verified"
    assert payload["execution_status"] == "idle"  # manual task was never running
    assert len(payload["submission_history"]) == 1
    assert client.patch(path, headers=alice_headers,
                        json={"network": project, "status": "done"}).status_code == 403
    assert client.post(f"{path}/assign", headers=alice_headers,
                       json={"network": project, "agent": "anything"}).status_code == 409
    assert client.delete(path, headers=admin, params={"network": project}).status_code == 403
    assert client.get(f"/v1/workspaces/{project}/plan-items", headers=admin).json()["data"]["items"][0]["tasks"][0]["status"] == "need_input"

    handoff = client.post(f"{path}/transfer", headers=admin,
                          json={"network": project, "user_id": bob["id"], "reason": "Coverage change"})
    assert handoff.status_code == 200, handoff.text
    assert handoff.json()["data"]["responsible_user_id"] == alice["id"]
    pending = client.get("/v1/tasks", headers=bob_headers, params={"network": project}).json()["data"]["tasks"]
    assert task["id"] in {t["id"] for t in pending}
    accepted = client.post(f"{path}/transfer-accept", headers=bob_headers, json={"network": project})
    assert accepted.status_code == 200, accepted.text
    next_task = accepted.json()["data"]
    assert next_task["id"] == task["id"] and next_task["channel_name"] == task["channel_name"]
    assert next_task["status"] == "backlog" and next_task["responsible_user_id"] == bob["id"]
    assert next_task["submission_history"][0]["summary"] == "Deployment verified"
    assert len(next_task["activity_history"]) >= 4
    assert task["id"] not in {t["id"] for t in client.get("/v1/tasks", headers=alice_headers,
                                   params={"network": project}).json()["data"]["tasks"] if t["responsible_user_id"]}


def test_member_cannot_dispatch_and_cross_project_membership_is_not_sufficient(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (bob, bob_headers) = _setup(client, db)
    other = _project(client, bob_headers)
    item = _plan(client, project, admin)
    assert _dispatch(client, project, item, admin, ["bogus"]).status_code == 400
    outsider, outsider_headers = _account(client, "outsider")
    assert _dispatch(client, project, item, admin, [outsider["id"]]).status_code == 400
    assert client.get(f"/v1/workspaces/{project}/plan-items", headers=outsider_headers).status_code == 403
    assert client.get(f"/v1/workspaces/{other}/plan-items", headers=alice_headers).status_code == 403
    assert db.execute(select(KanbanTask).where(KanbanTask.plan_item_id == item["id"])).scalars().all() == []


def test_plan_read_allows_project_roles_but_writes_remain_admin_only(local_auth, client, db):
    project, (_, owner_headers), (alice, member_headers), (bob, admin_headers) = _setup(client, db)
    viewer, viewer_headers = _account(client, "planviewer")
    _member(db, project, viewer, "viewer")
    membership = db.get(WorkspaceMembership, (project, bob["id"]))
    membership.role = "admin"
    db.commit()
    item = _plan(client, project, owner_headers)
    task = _dispatch(client, project, item, owner_headers, [alice["id"]]).json()["data"]["tasks"][0]

    for headers in (owner_headers, admin_headers, member_headers, viewer_headers):
        response = client.get(f"/v1/workspaces/{project}/plan-items", headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["data"]["items"][0]["tasks"][0]["id"] == task["id"]

    body = {"title": "Should not write", "version": item["version"]}
    for headers in (member_headers, viewer_headers):
        assert client.post(f"/v1/workspaces/{project}/plan-items", headers=headers,
                           json={"title": "Should not write"}).status_code == 403
        assert client.patch(f"/v1/workspaces/{project}/plan-items/{item['id']}", headers=headers,
                            json=body).status_code == 403
        assert client.delete(f"/v1/workspaces/{project}/plan-items/{item['id']}", headers=headers).status_code == 403
        assert _dispatch(client, project, item, headers, [viewer["id"]]).status_code == 403
        assert client.post(f"/v1/workspaces/{project}/plan-items/{item['id']}/publish", headers=headers,
                           json={"version": item["version"], "taskIds": [task["id"]]}).status_code == 403


def test_plan_read_rejects_machine_credentials_and_unauthenticated_callers(local_auth, client, db):
    project, (_, owner_headers), (_, _), (_, _) = _setup(client, db)
    _plan(client, project, owner_headers)
    machine_token = db.get(Workspace, project).password_hash
    url = f"/v1/workspaces/{project}/plan-items"
    assert machine_token
    assert client.get(url).status_code == 403
    assert client.get(url, params={"token": machine_token}).status_code == 403
    assert client.get(url, headers={"X-Workspace-Token": machine_token}).status_code == 403
    assert client.get(url, headers={"Authorization": f"Bearer {machine_token}"}).status_code == 403


def test_legacy_tasks_are_only_in_administrator_queue(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (_, _) = _setup(client, db)
    attempt = client.post("/v1/tasks", headers=alice_headers,
                          json={"network": project, "title": "Unassigned work"})
    assert attempt.status_code == 403
    created = client.post("/v1/tasks", headers=admin,
                          json={"network": project, "title": "Legacy work"})
    assert created.status_code == 200, created.text
    task_id = created.json()["data"]["id"]
    own = client.get("/v1/tasks", headers=alice_headers, params={"network": project}).json()["data"]["tasks"]
    admin_tasks = client.get("/v1/tasks", headers=admin, params={"network": project}).json()["data"]["tasks"]
    assert task_id not in {task["id"] for task in own}
    assert task_id in {task["id"] for task in admin_tasks}
    # A project member can inspect a task through its direct link.
    assert client.get(f"/v1/tasks/{task_id}", headers=alice_headers, params={"network": project}).status_code == 200
    assert client.patch(f"/v1/tasks/{task_id}", headers=alice_headers,
                        json={"network": project, "status": "done"}).status_code == 403


def test_plan_revision_publishes_into_original_task_not_duplicate(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (_, _) = _setup(client, db)
    item = _plan(client, project, admin)
    original = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    patch = client.patch(f"/v1/workspaces/{project}/plan-items/{item['id']}", headers=admin,
                         json={"title": "Revised release", "description": "Check staging, too",
                               "status": "doing", "priority": "urgent", "tags": ["release"],
                               "acceptanceCriteria": "Staging checklist attached", "version": item["version"]})
    assert patch.status_code == 200, patch.text
    revision = patch.json()["data"]
    assert revision["version"] == item["version"] + 1
    assert client.patch(f"/v1/workspaces/{project}/plan-items/{item['id']}", headers=admin,
                        json={"title": "Stale write", "version": item["version"]}).status_code == 409
    assert _dispatch(client, project, revision, admin, [alice["id"]]).status_code == 409
    old = client.get(f"/v1/tasks/{original['id']}", headers=alice_headers,
                     params={"network": project}).json()["data"]
    assert old["description"] == "Check the deployment" and old["source_version"] == item["version"]
    published = client.post(f"/v1/workspaces/{project}/plan-items/{item['id']}/publish", headers=admin,
                            json={"version": revision["version"], "taskIds": [original["id"]]})
    assert published.status_code == 200, published.text
    task = published.json()["data"]["tasks"][0]
    assert task["id"] == original["id"] and task["channel_name"] == original["channel_name"]
    assert task["priority"] == "urgent" and task["source_version"] == revision["version"]
    assert task["description"] == "Check staging, too"


def test_force_handoff_requires_original_owner_to_have_left(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (bob, _) = _setup(client, db)
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    path = f"/v1/tasks/{task['id']}/transfer"
    body = {"network": project, "user_id": bob["id"], "reason": "Owner left", "force": True}
    assert client.post(path, headers=admin, json=body).status_code == 409
    db.delete(db.get(WorkspaceMembership, (project, alice["id"])))
    db.commit()
    moved = client.post(path, headers=admin, json=body)
    assert moved.status_code == 200, moved.text
    assert moved.json()["data"]["id"] == task["id"]
    assert moved.json()["data"]["responsible_user_id"] == bob["id"]
    assert moved.json()["data"]["status"] == "backlog"


def test_handoff_does_not_change_dispatch_idempotency_key(local_auth, client, db):
    project, (_, admin), (alice, _), (bob, bob_headers) = _setup(client, db)
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    assert task["dispatched_user_id"] == alice["id"]
    path = f"/v1/tasks/{task['id']}"
    handoff = client.post(f"{path}/transfer", headers=admin,
                          json={"network": project, "user_id": bob["id"], "reason": "Coverage change"})
    assert handoff.status_code == 200, handoff.text
    assert client.post(f"{path}/transfer-accept", headers=bob_headers,
                       json={"network": project}).status_code == 200
    repeated = _dispatch(client, project, item, admin, [alice["id"]])
    assert repeated.status_code == 200, repeated.text
    dispatched = repeated.json()["data"]["tasks"]
    assert len(dispatched) == 1
    assert dispatched[0]["id"] == task["id"]
    assert dispatched[0]["responsible_user_id"] == bob["id"]
    assert dispatched[0]["dispatched_user_id"] == alice["id"]
    assert db.execute(select(KanbanTask).where(KanbanTask.plan_item_id == item["id"])).scalars().all() == [db.get(KanbanTask, task["id"])]
    # Bob now owns the original task, so raw dispatch cannot create a second one.
    assert _dispatch(client, project, item, admin, [bob["id"]]).status_code == 409
    summary = client.get(f"/v1/workspaces/{project}/plan-items", headers=admin).json()["data"]["items"][0]["tasks"][0]
    assert summary["dispatchedUserId"] == alice["id"] and summary["responsibleUserId"] == bob["id"]


def test_other_member_comment_cannot_start_agent_or_spoof_workflow_step(local_auth, client, db, monkeypatch):
    for hook in (
        "app.services.push.fanout_for_event",
        "app.services.cloud_agent.invoke_cloud_agents",
        "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event",
    ):
        monkeypatch.setattr(hook, lambda *_args: None)
    project, (_, admin), (alice, alice_headers), (_, bob_headers) = _setup(client, db)
    db.add(WorkspaceMember(workspace_id=project, agent_name="helper", status="offline"))
    db.commit()
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    path = f"/v1/tasks/{task['id']}"
    configured = client.post(f"{path}/configure", headers=alice_headers,
                             json={"network": project, "mode": "agent", "agent": "helper"})
    assert configured.status_code == 200, configured.text
    assert client.post(f"{path}/accept", headers=alice_headers,
                       json={"network": project}).status_code == 200
    comment = client.post("/v1/events", headers=bob_headers, json={
        "network": project, "source": "human:forged", "type": "workspace.message.posted",
        "target": f"channel/{task['channel_name']}", "payload": {"content": "@helper please run"},
        "metadata": {"task_workflow_step_complete": True, "target_agents": ["helper"]},
    })
    assert comment.status_code == 200, comment.text
    message = comment.json()["data"]
    assert message["metadata"]["task_comment"] is True
    assert message["metadata"]["target_agents"] == ["__no_response__"]
    assert "task_workflow_step_complete" not in message["metadata"]
    assert db.get(KanbanTask, task["id"]).execution_status == "idle"
    assert db.get(KanbanTask, task["id"]).status == "in_progress"
    run = client.post(f"{path}/assign", headers=alice_headers, json={"network": project})
    assert run.status_code == 200, run.text
    assert run.json()["data"]["execution_status"] == "running"
    assert run.json()["data"]["status"] == "in_progress"
    stopped = client.post(f"{path}/stop", headers=alice_headers, json={"network": project})
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["data"]["status"] == "in_progress"
    assert stopped.json()["data"]["execution_status"] == "paused"
    assert stopped.json()["data"]["active_run_id"] is None
    controls = db.execute(select(EventRecord).where(
        EventRecord.network_id == project,
        EventRecord.type == "workspace.agent.control",
        EventRecord.target == "openagents:helper",
    )).scalars().all()
    assert len(controls) == 1
    assert controls[0].payload["channel"] == task["channel_name"]


def test_workflow_human_step_requires_explicit_owner_action(local_auth, client, db, monkeypatch):
    import app.services.workflow as workflow
    monkeypatch.setattr(workflow, "_emit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(workflow, "notify", lambda *_args, **_kwargs: None)
    project, (_, admin), (alice, alice_headers), (_, bob_headers) = _setup(client, db)
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    assert client.post(f"/v1/tasks/{task['id']}/accept", headers=alice_headers,
                       json={"network": project}).status_code == 200
    row = db.get(KanbanTask, task["id"])
    row.workflow_id = "test-workflow"
    row.execution_status = "need_input"
    row.active_run_id = "test-run"
    run = WorkflowRun(
        workspace_id=project, workflow_id="test-workflow", channel_name=row.channel_name,
        current_step="review", status="running",
        snapshot={"name": "Review", "max_iterations": 2, "steps": [
            {"id": "review", "name": "Confirm", "instruction": "Confirm",
             "assignee": {"kind": "human", "human": alice["identity_key"]}},
        ]},
    )
    db.add(run)
    db.commit()
    action = f"/v1/tasks/{task['id']}/complete-step"
    assert client.post(action, headers=bob_headers,
                       json={"network": project, "content": "Approved"}).status_code == 403
    completed = client.post(action, headers=alice_headers,
                            json={"network": project, "content": "Approved"})
    assert completed.status_code == 200, completed.text
    assert completed.json()["data"]["status"] == "in_progress"
    db.refresh(run)
    assert run.status == "done"


def test_transfer_cancels_old_workflow_snapshot_before_new_owner_runs(local_auth, client, db):
    project, (_, admin), (alice, alice_headers), (bob, bob_headers) = _setup(client, db)
    item = _plan(client, project, admin)
    task = _dispatch(client, project, item, admin, [alice["id"]]).json()["data"]["tasks"][0]
    assert client.post(f"/v1/tasks/{task['id']}/accept", headers=alice_headers,
                       json={"network": project}).status_code == 200
    steps = [{"id": "review", "name": "Confirm", "instruction": "Confirm",
              "assignee": {"kind": "human", "human": alice["identity_key"]}}]
    workflow = Workflow(id="transfer-workflow", workspace_id=project, name="Review",
                        steps=steps, created_by=f"human:{alice['identity_key']}")
    run = WorkflowRun(workspace_id=project, workflow_id=workflow.id,
                      channel_name=task["channel_name"], current_step="review", status="running",
                      snapshot={"name": "Review", "steps": steps, "max_iterations": 2})
    row = db.get(KanbanTask, task["id"])
    row.workflow_id = workflow.id
    row.execution_status = "need_input"
    row.active_run_id = "old-run"
    db.add_all([workflow, run])
    db.commit()
    transfer = client.post(f"/v1/tasks/{task['id']}/transfer", headers=admin,
                           json={"network": project, "user_id": bob["id"], "reason": "Owner changed"})
    assert transfer.status_code == 200, transfer.text
    db.refresh(run)
    assert run.status == "cancelled"
    assert client.post(f"/v1/tasks/{task['id']}/transfer-accept", headers=bob_headers,
                       json={"network": project}).status_code == 200
    assert client.post(f"/v1/tasks/{task['id']}/accept", headers=bob_headers,
                       json={"network": project}).status_code == 200
    blocked = client.post(f"/v1/tasks/{task['id']}/assign", headers=bob_headers,
                          json={"network": project})
    assert blocked.status_code == 409
    assert db.get(KanbanTask, task["id"]).active_run_id is None
    assert db.get(KanbanTask, task["id"]).channel_name == task["channel_name"]
