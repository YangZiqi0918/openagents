"""Review decisions are scoped to the latest submission of a member task."""

import pytest
from sqlalchemy import select

from app.config import config
from app.models import KanbanTask, NotificationRecord, WorkspaceMembership


@pytest.fixture(autouse=True)
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "review-test-secret")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")


def account(client, name):
    data = client.post("/v1/auth/local/register", json={"username": name, "password": "simplepass"}).json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def setup_task(client, db):
    admin, admin_headers = account(client, "review-admin")
    member, member_headers = account(client, "review-member")
    other, other_headers = account(client, "review-other")
    project = client.post("/v1/workspaces", headers=admin_headers, json={"name": "Review project"}).json()["data"]["workspaceId"]
    db.add_all([WorkspaceMembership(workspace_id=project, user_id=u["id"], role="member") for u in (member, other)])
    db.commit()
    plan = client.post(f"/v1/workspaces/{project}/plan-items", headers=admin_headers,
                       json={"title": "Release", "acceptanceCriteria": "Provide test report"}).json()["data"]
    task = client.post(f"/v1/workspaces/{project}/plan-items/{plan['id']}/dispatch", headers=admin_headers,
                       json={"version": plan["version"], "userIds": [member["id"]]}).json()["data"]["tasks"][0]
    path = f"/v1/tasks/{task['id']}"
    assert client.post(f"{path}/accept", headers=member_headers, json={"network": project}).status_code == 200
    submitted = client.post(f"{path}/submit", headers=member_headers,
                            json={"network": project, "summary": "Test report ready"})
    assert submitted.status_code == 200, submitted.text
    return project, task["id"], (admin, admin_headers), (member, member_headers), (other, other_headers)


def review(client, project, task_id, headers, version, decision, comment=""):
    return client.post(f"/v1/workspaces/{project}/task-reviews/{task_id}/decision", headers=headers,
                       json={"submission_version": version, "decision": decision, "comment": comment})


def test_approve_is_admin_only_and_closes_the_task(client, db):
    project, task_id, (admin, admin_headers), (_, member_headers), _ = setup_task(client, db)
    url = f"/v1/workspaces/{project}/task-reviews"
    assert client.get(url, headers=member_headers).status_code == 403
    assert client.get(f"{url}/{task_id}", headers=member_headers).status_code == 403
    assert review(client, project, task_id, member_headers, 1, "approved").status_code == 403
    pending = client.get(url, headers=admin_headers).json()["data"]["items"]
    assert len(pending) == 1
    assert pending[0]["submission_version"] == 1
    assert pending[0]["acceptance_criteria"] == "Provide test report"
    assert pending[0]["plan_title"] == "Release"
    submitted_notice = db.execute(select(NotificationRecord).where(
        NotificationRecord.workspace_id == project, NotificationRecord.title == "Task awaiting review",
    )).scalar_one()
    assert submitted_notice.link_url == f"/projects/{project}?tab=review&task={task_id}"
    assert review(client, project, task_id, admin_headers, 2, "approved").status_code == 409
    accepted = review(client, project, task_id, admin_headers, 1, "approved", "Matches criteria")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["data"]["status"] == "done"
    entry = accepted.json()["data"]["submission_history"][0]
    assert entry["review_decision"] == "approved" and entry["reviewed_by_user_id"] == admin["id"]
    assert entry["user_id"] != entry["reviewed_by_user_id"]
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 409
    assert client.get(url, headers=admin_headers).json()["data"]["items"] == []
    assert client.get(f"{url}?state=processed", headers=admin_headers).json()["data"]["items"][0]["task_id"] == task_id
    assert db.execute(select(NotificationRecord).where(NotificationRecord.workspace_id == project,
                                                        NotificationRecord.recipient_user_id == entry["user_id"],
                                                        NotificationRecord.title == "Task approved")).scalar_one()
    plan = client.get(f"/v1/workspaces/{project}/plan-items", headers=admin_headers).json()["data"]["items"][0]
    assert plan["status"] == "done"


def test_admin_can_review_own_task_and_legacy_cards_are_excluded(client, db):
    project, _, (admin, admin_headers), _, _ = setup_task(client, db)
    plan = client.get(f"/v1/workspaces/{project}/plan-items", headers=admin_headers).json()["data"]["items"][0]
    own = client.post(f"/v1/workspaces/{project}/plan-items/{plan['id']}/dispatch", headers=admin_headers,
                      json={"version": plan["version"], "userIds": [admin["id"]]}).json()["data"]["tasks"][0]
    path = f"/v1/tasks/{own['id']}"
    assert client.post(f"{path}/accept", headers=admin_headers, json={"network": project}).status_code == 200
    assert client.post(f"{path}/submit", headers=admin_headers,
                       json={"network": project, "summary": "Ready"}).status_code == 200
    legacy = client.post("/v1/tasks", headers=admin_headers,
                         json={"network": project, "title": "Unassigned task", "status": "need_input"})
    assert legacy.status_code == 200
    pending = client.get(f"/v1/workspaces/{project}/task-reviews", headers=admin_headers).json()["data"]["items"]
    assert own["id"] in {entry["task_id"] for entry in pending}
    assert legacy.json()["data"]["id"] not in {entry["task_id"] for entry in pending}
    result = review(client, project, own["id"], admin_headers, 1, "approved")
    assert result.status_code == 200
    submission = result.json()["data"]["submission"]
    assert submission["user_id"] == submission["reviewed_by_user_id"] == admin["id"]


def test_return_requires_reason_then_new_submission_and_new_review(client, db):
    project, task_id, (_, admin_headers), (_, member_headers), _ = setup_task(client, db)
    assert review(client, project, task_id, admin_headers, 1, "returned", " ").status_code == 400
    returned = review(client, project, task_id, admin_headers, 1, "returned", "Attach screenshots")
    assert returned.status_code == 200
    assert returned.json()["data"]["status"] == "in_progress"
    assert returned.json()["data"]["submission"]["review_comment"] == "Attach screenshots"
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 409
    submitted = client.post(f"/v1/tasks/{task_id}/submit", headers=member_headers,
                            json={"network": project, "summary": "Screenshots attached"})
    assert submitted.status_code == 200
    pending = client.get(f"/v1/workspaces/{project}/task-reviews", headers=admin_headers).json()["data"]["items"]
    assert pending[0]["submission_version"] == 2
    assert pending[0]["submission_history"][0]["review_decision"] == "returned"
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 409
    assert review(client, project, task_id, admin_headers, 2, "approved").status_code == 200


def test_handoff_blocks_review_and_preserves_unreviewed_submission(client, db):
    project, task_id, (_, admin_headers), (_, member_headers), (other, other_headers) = setup_task(client, db)
    handoff = client.post(f"/v1/tasks/{task_id}/transfer", headers=admin_headers,
                          json={"network": project, "user_id": other["id"], "reason": "Coverage"})
    assert handoff.status_code == 200
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 409
    assert client.get(f"/v1/workspaces/{project}/task-reviews", headers=admin_headers).json()["data"]["items"] == []
    assert client.post(f"/v1/tasks/{task_id}/transfer-accept", headers=other_headers,
                       json={"network": project}).status_code == 200
    assert db.get(KanbanTask, task_id).submission_history[0]["summary"] == "Test report ready"
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 409
    assert client.get(f"/v1/workspaces/{project}/task-reviews?state=processed", headers=admin_headers).json()["data"]["items"] == []
    assert client.get(f"/v1/tasks/{task_id}", headers=member_headers, params={"network": project}).status_code == 200


def test_legacy_submission_and_project_isolation(client, db):
    project, task_id, (_, admin_headers), _, _ = setup_task(client, db)
    other_admin, other_headers = account(client, "foreign-review-admin")
    other_project = client.post("/v1/workspaces", headers=other_headers,
                                json={"name": "Other review project"}).json()["data"]["workspaceId"]
    assert client.get(f"/v1/workspaces/{other_project}/task-reviews/{task_id}", headers=other_headers).status_code == 404
    assert review(client, other_project, task_id, other_headers, 1, "approved").status_code == 404
    assert client.get(f"/v1/workspaces/{project}/task-reviews", headers=other_headers).status_code == 403
    task = db.get(KanbanTask, task_id)
    task.submission_history = [{"summary": "Old submission", "user_id": task.responsible_user_id}]
    db.commit()
    assert review(client, project, task_id, admin_headers, 1, "approved").status_code == 200
    assert db.get(KanbanTask, task_id).submission_history[0]["review_decision"] == "approved"
