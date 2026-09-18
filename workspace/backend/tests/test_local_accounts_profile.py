"""Real signed local identities, private networks, and project authorization."""

from urllib.parse import urlparse

import pytest
from sqlalchemy import select

from app.config import config
from app.local_accounts import verify_password
from app.models import User, Workspace, WorkspaceMember, WorkspaceMembership


@pytest.fixture(autouse=True)
def local_password_profile(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "local-identity-test-signing-key-not-for-deployment")
    monkeypatch.setattr(config, "WORKSPACE_SESSION_TTL_DAYS", 1)
    monkeypatch.setattr(config, "YUMI_ENABLED", False)


def register(client, username="alice"):
    response = client.post("/v1/auth/local/register", json={"username": username, "password": "secret123"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    headers = {"Authorization": f"Bearer {data['session_token']}"}
    space = client.get("/v1/account/personal-space", headers=headers)
    assert space.status_code == 200, space.text
    return data, headers, space.json()["data"]


def create_project(client, headers, name="Project A"):
    response = client.post("/v1/workspaces", json={"name": name, "description": "Shared project"}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def invite_token(data):
    return urlparse(data["url"]).path.rsplit("/", 1)[-1]


def test_registration_creates_only_private_space_and_hashed_password(client, db):
    data, headers, space = register(client, " Alice ")
    user = db.get(User, data["user"]["id"])
    assert user.username == "alice"
    assert user.email != "alice"
    assert user.local_password_hash != "secret123"
    assert verify_password("secret123", user.local_password_hash)
    assert space["kind"] == "personal"
    assert db.execute(select(Workspace)).scalars().all()[0].personal_owner_id == user.id
    assert client.get("/v1/account/workspaces", headers=headers).json()["data"] == []
    assert len(db.execute(select(Workspace)).scalars().all()) == 1


def test_registration_is_case_insensitive_and_login_checks_password(client, db):
    register(client)
    assert client.post("/v1/auth/local/register", json={"username": "ALICE", "password": "secret123"}).status_code == 409
    assert client.post("/v1/auth/local/login", json={"username": "ALICE", "password": "secret123"}).status_code == 200
    assert client.post("/v1/auth/local/login", json={"username": "alice", "password": "incorrect"}).status_code == 401
    assert client.post("/v1/auth/local/login", json={"username": "unknown", "password": "secret123"}).status_code == 401
    assert len(db.execute(select(Workspace)).scalars().all()) == 1


@pytest.mark.parametrize("body", [{"username": " ", "password": "secret123"}, {"username": "alice", "password": "short"}])
def test_minimum_credential_validation(client, body):
    assert client.post("/v1/auth/local/register", json=body).status_code == 422


def test_login_repairs_missing_personal_space_without_creating_project(client, db):
    data, headers, space = register(client)
    db.delete(db.get(Workspace, space["workspaceId"]))
    db.commit()
    response = client.post("/v1/auth/local/login", json={"username": "alice", "password": "secret123"})
    assert response.status_code == 200
    assert client.get("/v1/account/workspaces", headers=headers).json()["data"] == []
    spaces = db.execute(select(Workspace)).scalars().all()
    assert len(spaces) == 1 and spaces[0].kind == "personal"


def test_project_creation_requires_valid_identity_and_ignores_creator_email(client, db):
    _, headers, personal = register(client)
    assert client.post("/v1/workspaces", json={"name": "Anonymous"}).status_code == 401
    assert client.post("/v1/workspaces", json={"name": "Invalid"}, headers={"Authorization": "Bearer invalid"}).status_code == 401
    response = client.post("/v1/workspaces", json={"name": "Real", "creator_email": "someone-else@local.invalid"}, headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    project = db.get(Workspace, data["workspaceId"])
    owner = db.execute(select(User).where(User.username == "alice")).scalar_one()
    assert project.kind == "project" and project.personal_owner_id is None
    assert project.creator_email == owner.email
    membership = db.get(WorkspaceMembership, (project.id, owner.id))
    assert membership.role == "owner"
    assert not data.get("token")


def test_private_data_and_project_lists_are_independent(client, db):
    _, alice, personal_a = register(client)
    _, bob, personal_b = register(client, "bob")
    project = create_project(client, alice)
    own_task = client.post("/v1/tasks", json={"network": personal_a["workspaceId"], "title": "Private"}, headers=alice)
    assert own_task.status_code == 200
    assert client.get("/v1/tasks", params={"network": personal_a["workspaceId"]}, headers=bob).status_code in (401, 403)
    assert client.get(f"/v1/workspaces/{personal_a['workspaceId']}", headers=bob).status_code in (401, 403)
    assert client.get("/v1/workspaces").status_code == 401
    assert client.get("/v1/account/workspaces", headers=bob).json()["data"] == []
    listed = client.get("/v1/workspaces", headers=alice).json()["data"]
    assert [row["workspaceId"] for row in listed] == [project["workspaceId"]]
    assert personal_a["workspaceId"] != personal_b["workspaceId"]


def test_personal_space_cannot_invite_or_mutate_members(client):
    _, alice, space = register(client)
    register(client, "bob")
    base = f"/v1/workspaces/{space['workspaceId']}"
    assert client.post(f"{base}/invites", json={"username": "bob", "role": "member"}, headers=alice).status_code in (400, 403)
    assert client.post(f"{base}/team", json={"username": "bob", "role": "member"}, headers=alice).status_code in (400, 403)


def test_username_invite_reaches_private_inbox_and_only_joins_target_project(client):
    _, alice, _ = register(client)
    _, bob, personal_b = register(client, "bob")
    project_a = create_project(client, alice)
    create_project(client, alice, "Project B")
    response = client.post(f"/v1/workspaces/{project_a['workspaceId']}/invites", json={"username": "BOB", "role": "member"}, headers=alice)
    assert response.status_code == 200, response.text
    token = invite_token(response.json()["data"])
    inbox = client.get("/v1/notifications", params={"network": personal_b["workspaceId"]}, headers=bob).json()["data"]["notifications"]
    assert any(f"/invite/{token}" in (item["link_url"] or "") for item in inbox)
    assert client.post(f"/v1/invites/{token}/accept", headers=alice).status_code == 403
    assert client.post(f"/v1/invites/{token}/accept", headers=bob).status_code == 200
    assert [row["workspaceId"] for row in client.get("/v1/account/workspaces", headers=bob).json()["data"]] == [project_a["workspaceId"]]
    team = client.get(f"/v1/workspaces/{project_a['workspaceId']}/team", headers=bob).json()["data"]
    assert {member["username"] for member in team} == {"alice", "bob"}


def test_unknown_username_invite_does_not_create_user(client, db):
    _, alice, _ = register(client)
    project = create_project(client, alice)
    response = client.post(f"/v1/workspaces/{project['workspaceId']}/invites", json={"username": "unknown", "role": "member"}, headers=alice)
    assert response.status_code == 404
    assert len(db.execute(select(User)).scalars().all()) == 1


def test_viewer_token_cannot_override_role_and_removal_revokes_project_only(client, db):
    _, alice, _ = register(client)
    _, bob, personal_b = register(client, "bob")
    project = create_project(client, alice)
    base = f"/v1/workspaces/{project['workspaceId']}"
    invitation = client.post(f"{base}/invites", json={"username": "bob", "role": "viewer"}, headers=alice).json()["data"]
    assert client.post(f"/v1/invites/{invite_token(invitation)}/accept", headers=bob).status_code == 200
    assert client.get(f"{base}/team", headers=bob).status_code == 200
    raw_token = db.get(Workspace, project["workspaceId"]).password_hash
    assert client.post("/v1/tasks", json={"network": project["workspaceId"], "title": "Forbidden"}, headers={**bob, "X-Workspace-Token": raw_token}).status_code in (401, 403)
    me = client.get(f"{base}/me", headers={**bob, "X-Workspace-Token": raw_token}).json()["data"]
    assert me["effectiveRole"] == "viewer"
    assert client.post(f"{base}/invites", json={"role": "member"}, headers={"X-Workspace-Token": raw_token}).status_code in (401, 403)
    bob_user = db.execute(select(User).where(User.username == "bob")).scalar_one()
    assert client.delete(f"{base}/team/{bob_user.email}", headers=alice).status_code == 200
    assert client.get("/v1/tasks", params={"network": project["workspaceId"]}, headers=bob).status_code in (401, 403)
    assert client.get("/v1/tasks", params={"network": personal_b["workspaceId"]}, headers=bob).status_code == 200


def test_optional_assistant_failure_does_not_rollback_project_owner(client, db, monkeypatch):
    _, alice, _ = register(client)
    import app.services.yumi as yumi
    def broken(db, workspace):
        db.add(WorkspaceMember(workspace_id=workspace.id, agent_name="broken"))
        db.flush()
        raise RuntimeError("Simulated optional initialization failure")
    monkeypatch.setattr(yumi, "provision_yumi", broken)
    project = create_project(client, alice)
    assert client.get(f"/v1/workspaces/{project['workspaceId']}/me", headers=alice).json()["data"]["role"] == "owner"
    assert not db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == project["workspaceId"], WorkspaceMember.agent_name == "broken")).first()


def test_legacy_single_user_endpoint_cannot_expose_secured_containers(client, monkeypatch):
    _, alice, space = register(client)
    project = create_project(client, alice)
    monkeypatch.setattr(config, "AUTH_MODE", "workspace_token")
    monkeypatch.setattr(config, "LOCAL_MODE", True)
    for container in (space, project):
        response = client.post("/v1/workspaces/local-access", json={"workspace_id": container["workspaceId"]})
        assert response.status_code in (403, 404)
