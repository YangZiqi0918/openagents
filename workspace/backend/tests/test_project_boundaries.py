"""Regression tests for project membership, actor binding and revocation."""

import asyncio
import hashlib
import json

import pytest
from sqlalchemy import select

from app import cache
from app.access import verify_workspace_access
from app.config import config
from app.models import BrowserTab, Channel, EventRecord, FileRecord, KnowledgeEntry, NotificationRecord, ShareSnapshot, TodoRecord, User, Workflow, Workspace, WorkspaceInvite, WorkspaceMember, WorkspaceMembership
from app.routers import events
from tests.conftest import TestingSessionLocal


@pytest.fixture
def local_auth(monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "local_password")
    monkeypatch.setattr(config, "LOCAL_MODE", False)
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "project-boundary-test-signing-key")
    monkeypatch.setattr(config, "YUMI_API_KEY", "")
    monkeypatch.setattr(config, "FRONTEND_BASE_URL", "http://localhost:3000")


def _account(client, username):
    response = client.post("/v1/auth/local/register", json={"username": username, "password": "simplepass"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["user"], {"Authorization": f"Bearer {data['session_token']}"}


def _project(client, headers, name="Project"):
    response = client.post("/v1/workspaces", headers=headers, json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _member(db, project, user, role):
    membership = WorkspaceMembership(workspace_id=project["workspaceId"], user_id=user["id"], role=role)
    db.add(membership)
    db.commit()
    return membership


def _event(client, project, headers, **fields):
    return client.post("/v1/events", headers=headers, json={
        "network": project["workspaceId"], "type": "workspace.message.posted",
        "source": "human:forged", "target": "channel/notes", "payload": {"content": "hello"},
        **fields,
    })


def test_cached_machine_credential_does_not_override_bearer(local_auth, client, db, monkeypatch):
    _, alice_headers = _account(client, "alice")
    _, bob_headers = _account(client, "bob")
    project = _project(client, alice_headers)
    workspace = db.get(Workspace, project["workspaceId"])
    machine_token = workspace.password_hash
    cached = json.dumps({"id": workspace.id, "ph_sha": hashlib.sha256(machine_token.encode()).hexdigest()}).encode()
    monkeypatch.setattr(cache, "get_bytes", lambda _key: cached)
    response = client.get("/v1/events", params={"network": workspace.id},
                          headers={**bob_headers, "X-Workspace-Token": machine_token})
    assert response.status_code in {401, 403}
    assert verify_workspace_access(workspace, machine_token, "Bearer invalid", db=db) is False
    assert verify_workspace_access(workspace, machine_token, "Bearer ", db=db) is False
    assert verify_workspace_access(workspace, machine_token, None, db=db) is True


def test_viewer_reads_team_but_cannot_write_or_inherit_token_role(local_auth, client, db):
    _, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    project = _project(client, alice_headers)
    _member(db, project, bob, "viewer")
    token = db.get(Workspace, project["workspaceId"]).password_hash
    headers = {**bob_headers, "X-Workspace-Token": token}
    team = client.get(f"/v1/workspaces/{project['workspaceId']}/team", headers=headers)
    assert team.status_code == 200
    assert {member["username"] for member in team.json()["data"]} == {"alice", "bob"}
    me = client.get(f"/v1/workspaces/{project['workspaceId']}/me", headers=headers).json()["data"]
    assert me["effectiveRole"] == "viewer" and me["tokenAccess"] is False
    assert client.post("/v1/tasks", headers=headers, json={"network": project["workspaceId"], "title": "Denied"}).status_code in {401, 403}
    assert client.post(f"/v1/workspaces/{project['workspaceId']}/invites", headers=headers, json={}).status_code == 403


def test_machine_only_cannot_mutate_human_members(local_auth, client, db):
    _, alice_headers = _account(client, "alice")
    _account(client, "bob")
    project = _project(client, alice_headers)
    token = db.get(Workspace, project["workspaceId"]).password_hash
    response = client.post(f"/v1/workspaces/{project['workspaceId']}/team",
                           headers={"X-Workspace-Token": token}, json={"username": "bob"})
    assert response.status_code == 403


def test_username_invite_notifies_private_inbox_and_stays_in_one_project(local_auth, client, db, monkeypatch):
    _, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    first = _project(client, alice_headers, "A")
    second = _project(client, alice_headers, "B")
    def no_email(**_kwargs):
        pytest.fail("Local username invitations must not send email")
    monkeypatch.setattr("app.services.email.send_invite_email", no_email)
    invitation = client.post(f"/v1/workspaces/{first['workspaceId']}/invites", headers=alice_headers,
                             json={"username": " BOB ", "role": "member"})
    assert invitation.status_code == 200, invitation.text
    data = invitation.json()["data"]
    assert data["username"] == "bob" and data["emailSent"] is False
    personal = db.execute(select(Workspace).where(Workspace.personal_owner_id == bob["id"])).scalar_one()
    notice = db.execute(select(NotificationRecord).where(NotificationRecord.workspace_id == personal.id)).scalar_one()
    assert notice.link_url == data["url"]
    token = data["url"].rsplit("/", 1)[1]
    peek = client.get(f"/v1/invites/{token}").json()["data"]
    assert peek["invitedUsername"] == "bob" and peek["invitedEmail"] is None
    assert client.post(f"/v1/invites/{token}/accept", headers=alice_headers).status_code == 403
    assert client.post(f"/v1/invites/{token}/accept", headers=bob_headers).status_code == 200
    projects = client.get("/v1/account/workspaces", headers=bob_headers).json()["data"]
    assert [project["workspaceId"] for project in projects] == [first["workspaceId"]]
    assert client.get(f"/v1/workspaces/{second['workspaceId']}", headers=bob_headers).status_code in {401, 403}


def test_unknown_username_does_not_create_placeholder(local_auth, client, db):
    _, headers = _account(client, "alice")
    project = _project(client, headers)
    response = client.post(f"/v1/workspaces/{project['workspaceId']}/invites", headers=headers,
                           json={"username": "unregistered"})
    assert response.status_code == 404
    assert db.query(User).count() == 1
    assert db.query(WorkspaceInvite).count() == 0


def test_direct_member_upsert_cannot_demote_last_owner(local_auth, client, db):
    alice, alice_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    project = _project(client, alice_headers)
    _member(db, project, bob, "admin")
    path = f"/v1/workspaces/{project['workspaceId']}/team"
    assert client.post(path, headers=bob_headers, json={"username": "alice", "role": "member"}).status_code == 403
    assert client.post(path, headers=alice_headers, json={"username": "alice", "role": "member"}).status_code == 400
    membership = db.execute(select(WorkspaceMembership).where(
        WorkspaceMembership.workspace_id == project["workspaceId"], WorkspaceMembership.user_id == alice["id"],
    )).scalar_one()
    db.refresh(membership)
    assert membership.role == "owner"


def test_bearer_event_actor_and_sender_are_server_bound(local_auth, client, monkeypatch):
    user, headers = _account(client, "alice")
    project = _project(client, headers)
    for service in ("app.services.push.fanout_for_event", "app.services.cloud_agent.invoke_cloud_agents",
                    "app.services.workflow.advance_workflow", "app.services.integrations.relay_for_event"):
        monkeypatch.setattr(service, lambda *_args: None)
    response = _event(client, project, headers, payload={"content": "hello", "sender_email": "victim@example.com", "sender_type": "agent"},
                      metadata={"sender_email": "victim@example.com"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["source"] == f"human:{user['identity_key']}"
    assert data["payload"]["sender_email"] == user["identity_key"]
    assert data["payload"]["sender_type"] == "human"
    assert data["metadata"]["sender_email"] == user["identity_key"]


def test_event_attachment_and_human_participants_cannot_cross_scope(local_auth, client, db):
    _, alice_headers = _account(client, "alice")
    bob, _ = _account(client, "bob")
    first = _project(client, alice_headers, "A")
    second = _project(client, alice_headers, "B")
    file = FileRecord(workspace_id=second["workspaceId"], filename="secret.txt", size=1,
                      storage_key="unused-test-key", uploaded_by="human:test")
    db.add(file)
    db.commit()
    assert _event(client, first, alice_headers, payload={"content": "hello", "attachments": [{"fileId": file.id}]}).status_code == 400
    assert _event(client, first, alice_headers, type="network.channel.create", payload={"name": "private", "human_participants": [bob["identity_key"]]}).status_code == 400


def test_identity_stream_closes_before_delivering_after_revocation(local_auth, client, db, monkeypatch):
    _, alice_headers = _account(client, "alice")
    bob, headers = _account(client, "bob")
    project = _project(client, alice_headers)
    membership = _member(db, project, bob, "member")
    monkeypatch.setattr(events, "SessionLocal", TestingSessionLocal)
    clock = [0.0]
    async def feed(_channel):
        yield json.dumps({"id": "before", "target": "channel/notes"}).encode()
        db.delete(membership)
        db.commit()
        clock[0] = 4.1
        yield json.dumps({"id": "after", "target": "channel/notes"}).encode()
    monkeypatch.setattr(cache, "subscribe_events", feed)
    class Request:
        async def is_disconnected(self):
            return False
    async def consume():
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "time", lambda: clock[0])
        response = await events.stream_events(Request(), network=project["workspaceId"], channel=None,
                                              token=None, x_workspace_token=None, authorization=headers["Authorization"])
        return "".join([chunk async for chunk in response.body_iterator])
    output = asyncio.run(consume())
    assert "id: before" in output
    assert "access-revoked" in output
    assert "id: after" not in output


def test_legacy_local_access_never_exposes_new_account_container_tokens(local_auth, client, db, monkeypatch):
    _, headers = _account(client, "alice")
    project = _project(client, headers)
    personal = client.get("/v1/account/personal-space", headers=headers).json()["data"]
    monkeypatch.setattr(config, "AUTH_MODE", "workspace_token")
    monkeypatch.setattr(config, "LOCAL_MODE", True)
    # Creation/rotation through an old profile sharing this DB must not return
    # the new account's transferable project credential either.
    legacy_created = client.post("/v1/workspaces", headers=headers, json={"name": "Legacy endpoint"})
    assert legacy_created.status_code == 200
    assert legacy_created.json()["data"]["token"] is None
    assert client.post(f"/v1/workspaces/{project['workspaceId']}/rotate-token", headers=headers).status_code == 403
    for container in (project, personal):
        response = client.post("/v1/workspaces/local-access", json={"workspace_id": container["workspaceId"]})
        assert response.status_code == 404
    response = client.post("/v1/workspaces/local-access", json={})
    assert response.status_code == 200
    assert response.json()["data"]["workspaceId"] not in {project["workspaceId"], personal["workspaceId"]}


def test_snapshot_links_never_bypass_personal_or_project_access(local_auth, client, db, monkeypatch):
    _, owner_headers = _account(client, "alice")
    viewer, viewer_headers = _account(client, "bob")
    _, outsider_headers = _account(client, "carol")
    project = _project(client, owner_headers)
    personal = client.get("/v1/account/personal-space", headers=owner_headers).json()["data"]
    _member(db, project, viewer, "viewer")
    for container in (project, personal):
        snapshot = ShareSnapshot(workspace_id=container["workspaceId"], channel_name="notes",
                                 title="Private notes", created_by="human:alice",
                                 snapshot_data=[{"content": "confidential"}], share_token=f"share-{container['kind']}",
                                 message_count=1)
        db.add(snapshot)
        db.commit()
        path = f"/v1/shares/public/{snapshot.share_token}"
        assert client.get(path).status_code == 403
        assert client.get(path, headers=outsider_headers).status_code == 403
        assert client.get(path, headers={"X-Workspace-Token": db.get(Workspace, container["workspaceId"]).password_hash}).status_code == 403
        assert client.get(path, headers=owner_headers).status_code == 200
        assert client.get(path, headers=viewer_headers).status_code == (200 if container["kind"] == "project" else 403)
    # A legacy LOCAL_MODE service sharing this DB may not serve new users' snapshots publicly.
    monkeypatch.setattr(config, "AUTH_MODE", "workspace_token")
    monkeypatch.setattr(config, "LOCAL_MODE", True)
    assert client.get("/v1/shares/public/share-project").status_code == 403
    assert client.get("/v1/shares/public/share-personal").status_code == 403


def test_knowledge_id_from_other_project_cannot_be_updated_or_deleted(local_auth, client, db):
    _, headers = _account(client, "alice")
    first = _project(client, headers, "A")
    second = _project(client, headers, "B")
    entry = KnowledgeEntry(workspace_id=second["workspaceId"], slug="other", title="Other",
                           created_by="human:alice", status="active")
    db.add(entry)
    db.commit()
    patch = client.put(f"/v1/knowledge/{entry.id}", headers=headers,
                       json={"network": first["workspaceId"], "title": "Tampered"})
    remove = client.delete(f"/v1/knowledge/{entry.id}", params={"network": first["workspaceId"]}, headers=headers)
    assert patch.status_code == remove.status_code == 404
    db.refresh(entry)
    assert entry.title == "Other" and entry.status == "active"


def test_task_and_workflow_references_are_confined_to_current_project(local_auth, client, db):
    _, headers = _account(client, "alice")
    first = _project(client, headers, "A")
    second = _project(client, headers, "B")
    flow = Workflow(workspace_id=second["workspaceId"], name="Foreign", steps=[], created_by="human:alice")
    file = FileRecord(workspace_id=second["workspaceId"], filename="f.txt", size=1, storage_key="test",
                      uploaded_by="human:alice")
    db.add_all([flow, file])
    db.commit()
    url = "/v1/tasks"
    for field, value in (("workflow_id", flow.id), ("file_ids", [file.id]), ("assignee", "other-project-agent")):
        response = client.post(url, headers=headers, json={"network": first["workspaceId"], "title": "No", field: value})
        assert response.status_code == 400, response.text
    response = client.post("/v1/workflows", headers=headers, json={
        "network": first["workspaceId"], "name": "No", "steps": [
            {"name": "No", "instruction": "Do this", "assignee": {"kind": "agent", "agent": "other-project-agent"}},
        ],
    })
    assert response.status_code == 400


def test_browser_viewer_does_not_receive_interactive_session_url(local_auth, client, db):
    _, owner_headers = _account(client, "alice")
    viewer, headers = _account(client, "bob")
    project = _project(client, owner_headers)
    _member(db, project, viewer, "viewer")
    tab = BrowserTab(workspace_id=project["workspaceId"], url="https://example.com", title="Tab",
                     live_url="https://live.example.com/secret", session_id="secret-session", created_by="human:alice")
    db.add(tab)
    db.commit()
    response = client.get(f"/v1/browser/tabs/{tab.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert "live_url" not in response.json()["data"]
    assert "session_id" not in response.json()["data"]
    assert client.post(f"/v1/browser/tabs/{tab.id}/share", headers=headers,
                       json={"agent_name": "foreign-agent"}).status_code in {401, 403}


def test_bearer_only_admin_task_execution_creates_channel_and_kickoff(local_auth, client, db):
    alice, owner_headers = _account(client, "alice")
    _, member_headers = _account(client, "bob")
    project = _project(client, owner_headers)
    bob = db.execute(select(User).where(User.username == "bob")).scalar_one()
    _member(db, project, {"id": str(bob.id)}, "member")
    db.add(WorkspaceMember(workspace_id=project["workspaceId"], agent_name="worker", role="master",
                           agent_type="claude", status="online"))
    db.commit()
    assert client.post("/v1/tasks", headers=member_headers,
                       json={"network": project["workspaceId"], "title": "Cannot self-create"}).status_code == 403
    created = client.post("/v1/tasks", headers=owner_headers,
                          json={"network": project["workspaceId"], "title": "Do a thing", "assignee": "worker"})
    assert created.status_code == 200, created.text
    task_id = created.json()["data"]["id"]
    assert client.post(f"/v1/tasks/{task_id}/assign", headers=member_headers,
                       json={"network": project["workspaceId"]}).status_code == 403
    ran = client.post(f"/v1/tasks/{task_id}/assign", headers=owner_headers,
                      json={"network": project["workspaceId"], "source": "human:forged"})
    assert ran.status_code == 200, ran.text
    assert ran.json()["data"]["status"] == "in_progress"
    channel_name = f"task:{task_id}"
    assert db.execute(select(Channel.id).where(Channel.workspace_id == project["workspaceId"], Channel.name == channel_name)).first()
    events = db.execute(select(EventRecord).where(EventRecord.network_id == project["workspaceId"],
                           EventRecord.target == f"channel/{channel_name}", EventRecord.type == "workspace.message.posted")).scalars().all()
    assert any(e.source == f"human:{alice['identity_key']}" and "assigned this Kanban task" in (e.payload or {}).get("content", "") for e in events)


def test_human_todo_source_cannot_delete_another_members_plan(local_auth, client, db):
    alice, owner_headers = _account(client, "alice")
    bob, bob_headers = _account(client, "bob")
    project = _project(client, owner_headers)
    _member(db, project, bob, "member")
    db.add(Channel(workspace_id=project["workspaceId"], name="notes", title="Notes", created_by=f"human:{alice['identity_key']}"))
    db.add(TodoRecord(workspace_id=project["workspaceId"], channel_name="notes",
                      created_by=f"human:{alice['identity_key']}", assignee="alice", content="Owner item", position=0))
    db.commit()
    response = client.put("/v1/todos", headers=bob_headers, json={
        "network": project["workspaceId"], "source": f"human:{alice['identity_key']}",
        "channel": "notes", "todos": [{"content": "Bob item", "status": "pending"}],
    })
    assert response.status_code == 200, response.text
    rows = db.execute(select(TodoRecord).where(TodoRecord.workspace_id == project["workspaceId"])).scalars().all()
    assert {(row.created_by, row.content) for row in rows} == {
        (f"human:{alice['identity_key']}", "Owner item"), (f"human:{bob['identity_key']}", "Bob item"),
    }


def test_machine_poll_cache_is_invalidated_when_token_rotates_or_project_deletes(local_auth, client, db, monkeypatch):
    _, owner_headers = _account(client, "alice")
    project = _project(client, owner_headers)
    workspace = db.get(Workspace, project["workspaceId"])
    old_token = workspace.password_hash
    entries = {}
    monkeypatch.setattr(cache, "get_bytes", lambda key: entries.get(key))
    monkeypatch.setattr(cache, "set_bytes", lambda key, value, **_kwargs: entries.__setitem__(key, value))
    monkeypatch.setattr(cache, "delete_key", lambda key: entries.pop(key, None))
    for identifier in (project["workspaceId"], project["slug"]):
        assert events._resolve_and_auth_cached(db, identifier, old_token, None)[1] is None
    assert len(entries) == 2
    rotated = client.post(f"/v1/workspaces/{project['workspaceId']}/rotate-token",
                          headers={"X-Workspace-Token": old_token})
    assert rotated.status_code == 200
    assert entries == {}
    db.expire_all()
    assert events._resolve_and_auth_cached(db, project["workspaceId"], old_token, None)[1] is not None
    new_token = rotated.json()["data"]["token"]
    assert events._resolve_and_auth_cached(db, project["slug"], new_token, None)[1] is None
    assert client.delete(f"/v1/workspaces/{project['workspaceId']}", headers=owner_headers).status_code == 200
    assert entries == {}
    db.expire_all()
    assert events._resolve_and_auth_cached(db, project["slug"], new_token, None)[1] is not None
