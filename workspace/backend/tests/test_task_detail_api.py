"""Plan task detail timeline, safe comments, and review actions."""

import pytest
from sqlalchemy import delete, select

import app.routers.tasks as tasks_router
from app.config import config
from app.models import EventRecord, FileRecord, KanbanTask, NotificationRecord, WorkspaceMembership


@pytest.fixture(autouse=True)
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "task-detail-test-secret")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def _account(client, username):
    payload = client.post(
        "/v1/auth/local/register", json={"username": username, "password": "simplepass"},
    ).json()["data"]
    return payload["user"], {"Authorization": f"Bearer {payload['session_token']}"}


def _setup(client, db):
    owner, owner_headers = _account(client, "detail-owner")
    assignee, assignee_headers = _account(client, "detail-assignee")
    commenter, commenter_headers = _account(client, "detail-commenter")
    viewer, viewer_headers = _account(client, "detail-viewer")
    project = client.post(
        "/v1/workspaces", headers=owner_headers, json={"name": "Task detail project"},
    ).json()["data"]["workspaceId"]
    db.add_all([
        WorkspaceMembership(workspace_id=project, user_id=assignee["id"], role="member"),
        WorkspaceMembership(workspace_id=project, user_id=commenter["id"], role="member"),
        WorkspaceMembership(workspace_id=project, user_id=viewer["id"], role="viewer"),
    ])
    attachment = FileRecord(
        workspace_id=project, filename="proof.png", content_type="image/png", size=42,
        storage_key="tests/proof.png", uploaded_by=f"human:{owner['identity_key']}",
    )
    db.add(attachment)
    db.commit()
    plan = client.post(
        f"/v1/workspaces/{project}/plan-items", headers=owner_headers,
        json={
            "title": "Ship task detail", "description": "Implement the drawer",
            "priority": "high", "attachments": [{"id": attachment.id, "name": attachment.filename}],
            "acceptanceCriteria": "Comments remain side-effect free",
        },
    ).json()["data"]
    task = client.post(
        f"/v1/workspaces/{project}/plan-items/{plan['id']}/dispatch", headers=owner_headers,
        json={"version": plan["version"], "userIds": [assignee["id"]]},
    ).json()["data"]["tasks"][0]
    return {
        "project": project, "plan": plan, "task": task, "file": attachment,
        "owner": (owner, owner_headers), "assignee": (assignee, assignee_headers),
        "commenter": (commenter, commenter_headers), "viewer": (viewer, viewer_headers),
    }


def test_detail_requires_member_and_includes_attachment_metadata(client, db):
    data = _setup(client, db)
    url = f"/v1/tasks/{data['task']['id']}"
    assert client.get(url, headers=data["viewer"][1], params={"network": data["project"]}).status_code == 403
    detail = client.get(url, headers=data["commenter"][1], params={"network": data["project"]})
    assert detail.status_code == 200, detail.text
    assert detail.json()["data"]["attachments"] == [{
        "id": data["file"].id, "filename": "proof.png", "contentType": "image/png", "size": 42,
    }]


def test_comment_endpoint_is_side_effect_free_and_timeline_is_pageable(client, db, monkeypatch):
    data = _setup(client, db)
    path = f"/v1/tasks/{data['task']['id']}"
    assert client.post(f"{path}/accept", headers=data["assignee"][1],
                       json={"network": data["project"]}).status_code == 200
    row = db.get(KanbanTask, data["task"]["id"])
    row.assignee = "helper"
    row.execution_status = "running"
    row.active_run_id = "active-run"
    db.commit()

    own_comment = client.post(
        f"{path}/comments", headers=data["assignee"][1],
        json={"network": data["project"], "content": "Owner note @helper", "fileIds": [data["file"].id]},
    )
    assert own_comment.status_code == 200, own_comment.text
    assert own_comment.json()["data"]["categories"] == ["comments"]
    assert own_comment.json()["data"]["attachments"][0]["filename"] == "proof.png"
    db.refresh(row)
    assert (row.status, row.execution_status, row.active_run_id) == ("in_progress", "running", "active-run")
    stored = db.get(EventRecord, own_comment.json()["data"]["id"])
    assert stored.metadata_["task_comment"] is True
    assert stored.metadata_["target_agents"] == ["__no_response__"]
    assert db.execute(select(NotificationRecord).where(
        NotificationRecord.workspace_id == data["project"],
        NotificationRecord.title == "Task comment",
    )).scalars().all() == []

    other_comment = client.post(
        f"{path}/comments", headers=data["commenter"][1],
        json={"network": data["project"], "content": "Looks good", "fileIds": []},
    )
    assert other_comment.status_code == 200, other_comment.text
    notice = db.execute(select(NotificationRecord).where(
        NotificationRecord.workspace_id == data["project"],
        NotificationRecord.title == "Task comment",
    )).scalar_one()
    assert notice.recipient_user_id == data["assignee"][0]["id"]
    assert notice.link_url == (
        f"/projects/{data['project']}?tab=plan&item={data['plan']['id']}"
        f"&task={data['task']['id']}&view=comments"
    )

    db.add_all([
        EventRecord(
            id=f"irrelevant-{index:03d}", network_id=data["project"],
            type="workspace.message.posted", source="openagents:helper",
            target=f"channel/{data['task']['channel_name']}",
            payload={"content": f"progress {index}", "message_type": "status"},
            metadata_={"target_agents": ["__no_response__"]}, timestamp=index,
        )
        for index in range(100)
    ])
    db.commit()
    converted = []
    original_converter = tasks_router._timeline_event_item

    def track_conversion(event, *args):
        converted.append(event.id)
        return original_converter(event, *args)

    monkeypatch.setattr(tasks_router, "_timeline_event_item", track_conversion)

    first = client.get(
        f"{path}/timeline", headers=data["commenter"][1],
        params={"network": data["project"], "category": "comments", "sort": "desc", "limit": 1},
    ).json()["data"]
    assert len(first["items"]) == 1 and first["nextCursor"]
    assert len(converted) == 2  # SQL comments filter + limit+1; 100 activity rows were not materialized.
    second = client.get(
        f"{path}/timeline", headers=data["commenter"][1],
        params={"network": data["project"], "category": "comments", "sort": "desc",
                "limit": 1, "cursor": first["nextCursor"]},
    ).json()["data"]
    assert len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert client.get(
        f"{path}/timeline", headers=data["viewer"][1], params={"network": data["project"]},
    ).status_code == 403


def test_timeline_history_attachment_isolation_and_review_wrapper(client, db):
    data = _setup(client, db)
    path = f"/v1/tasks/{data['task']['id']}"
    foreign_owner, foreign_headers = _account(client, "detail-foreign")
    foreign_project = client.post(
        "/v1/workspaces", headers=foreign_headers, json={"name": "Foreign"},
    ).json()["data"]["workspaceId"]
    foreign_file = FileRecord(
        workspace_id=foreign_project, filename="secret.txt", content_type="text/plain", size=1,
        storage_key="tests/secret.txt", uploaded_by=f"human:{foreign_owner['identity_key']}",
    )
    db.add(foreign_file)
    db.commit()
    rejected = client.post(
        f"{path}/comments", headers=data["commenter"][1],
        json={"network": data["project"], "content": "bad file", "fileIds": [foreign_file.id]},
    )
    assert rejected.status_code == 400

    history = client.get(
        f"{path}/timeline", headers=data["assignee"][1],
        params={"network": data["project"], "category": "history"},
    ).json()["data"]["items"]
    assert [item["kind"] for item in history] == ["dispatched"]

    assert client.post(f"{path}/accept", headers=data["assignee"][1],
                       json={"network": data["project"]}).status_code == 200
    assert client.post(f"{path}/submit", headers=data["assignee"][1], json={
        "network": data["project"], "summary": "Ready", "file_ids": [data["file"].id],
    }).status_code == 200
    assert client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "decision": "approve", "note": "",
    }).status_code == 422
    assert client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "submissionVersion": 0,
        "decision": "approve", "note": "",
    }).status_code == 422
    assert client.post(f"{path}/review", headers=data["assignee"][1], json={
        "network": data["project"], "submissionVersion": 1,
        "decision": "approve", "note": "",
    }).status_code == 403
    assert client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "submissionVersion": 2,
        "decision": "request_changes", "note": "Stale",
    }).status_code == 409
    assert client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "submissionVersion": 1,
        "decision": "request_changes", "note": "Add a screenshot",
    }).json()["data"]["status"] == "in_progress"
    assert client.post(f"{path}/submit", headers=data["assignee"][1], json={
        "network": data["project"], "summary": "Ready with screenshot", "file_ids": [],
    }).status_code == 200
    assert client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "submissionVersion": 1,
        "decision": "approve", "note": "Stale",
    }).status_code == 409
    approved = client.post(f"{path}/review", headers=data["owner"][1], json={
        "network": data["project"], "submissionVersion": 2,
        "decision": "approve", "note": "Accepted",
    })
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "done"
    transitions = client.get(
        f"{path}/timeline", headers=data["assignee"][1],
        params={"network": data["project"], "category": "transition", "actorType": "human"},
    ).json()["data"]["items"]
    kinds = [item["kind"] for item in transitions]
    assert kinds.count("submitted") == 2
    assert "review_returned" in kinds and "review_approved" in kinds
    assert all(item["actor"]["type"] == "human" for item in transitions)


def test_timeline_synthesizes_legacy_histories_without_duplicate_submission(client, db):
    data = _setup(client, db)
    task = db.get(KanbanTask, data["task"]["id"])
    db.execute(delete(EventRecord).where(EventRecord.target == f"task/{task.id}"))
    task.activity_history = [
        {"action": "accepted", "actor_user_id": data["assignee"][0]["id"],
         "at": "2026-09-20T08:00:00+00:00"},
        {"action": "submitted", "actor_user_id": data["assignee"][0]["id"],
         "at": "2026-09-20T08:01:00+00:00"},
    ]
    task.submission_history = [{
        "summary": "Legacy result", "file_ids": [data["file"].id],
        "user_id": data["assignee"][0]["id"], "submitted_at": "2026-09-20T08:01:00+00:00",
        "review_decision": "approved", "review_comment": "Legacy approval",
        "reviewed_by_user_id": data["owner"][0]["id"], "reviewed_at": "2026-09-20T08:02:00+00:00",
    }]
    db.commit()
    timeline = client.get(
        f"/v1/tasks/{task.id}/timeline", headers=data["assignee"][1],
        params={"network": data["project"], "sort": "asc"},
    ).json()["data"]["items"]
    assert [item["kind"] for item in timeline] == ["accepted", "submitted", "review_approved"]
    assert timeline[1]["attachments"][0]["filename"] == "proof.png"


def test_comment_timeline_without_a_channel_never_leaks_workspace_events(client, db):
    data = _setup(client, db)
    task = db.get(KanbanTask, data["task"]["id"])
    task.channel_name = None
    db.add(EventRecord(
        id="unrelated-task-comment", network_id=data["project"],
        type="workspace.message.posted", source="human:someone@local.invalid",
        target="channel/task:some-other-task", payload={"content": "private", "message_type": "chat"},
        metadata_={"task_comment": True}, timestamp=1, visibility="channel",
    ))
    db.commit()

    response = client.get(
        f"/v1/tasks/{task.id}/timeline", headers=data["assignee"][1],
        params={"network": data["project"], "category": "comments"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["items"] == []


def test_stop_records_only_a_real_execution_transition(client, db):
    data = _setup(client, db)
    path = f"/v1/tasks/{data['task']['id']}"
    assert client.post(f"{path}/accept", headers=data["assignee"][1],
                       json={"network": data["project"]}).status_code == 200
    task = db.get(KanbanTask, data["task"]["id"])
    task.execution_status = "need_input"
    task.active_run_id = None
    db.commit()

    no_op = client.post(f"{path}/stop", headers=data["assignee"][1],
                        json={"network": data["project"]})
    assert no_op.status_code == 200
    assert no_op.json()["data"]["execution_status"] == "need_input"
    stopped = db.execute(select(EventRecord).where(
        EventRecord.target == f"task/{task.id}",
        EventRecord.type == "workspace.task.transition",
    )).scalars().all()
    assert all((event.payload or {}).get("kind") != "execution_stopped" for event in stopped)

    task.active_run_id = "run-to-stop"
    db.commit()
    response = client.post(f"{path}/stop", headers=data["assignee"][1],
                           json={"network": data["project"]})
    assert response.status_code == 200
    assert response.json()["data"]["execution_status"] == "paused"
    event = db.execute(select(EventRecord).where(
        EventRecord.target == f"task/{task.id}",
        EventRecord.type == "workspace.task.transition",
    ).order_by(EventRecord.timestamp.desc())).scalars().first()
    assert event.payload["kind"] == "execution_stopped"
    assert event.payload["from"] == "need_input" and event.payload["to"] == "paused"
