from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select

from app.config import config
from app.models import Workspace


@pytest.fixture(autouse=True)
def hosted_by_default(monkeypatch):
    monkeypatch.setattr(config, 'LOCAL_MODE', False)


@pytest.fixture
def local_mode(monkeypatch):
    monkeypatch.setattr(config, 'LOCAL_MODE', True)


def test_hosted_mode_does_not_expose_local_credentials(client, workspace):
    response = client.post('/v1/workspaces/local-access', json={'workspace_id': workspace['id']})
    assert response.status_code == 404
    assert response.json()['data'] is None


def test_hosted_mode_does_not_create_local_workspace(client, db):
    assert client.post('/v1/workspaces/local-access', json={}).status_code == 404
    assert list(db.scalars(select(Workspace))) == []


def test_local_mode_bootstraps_once_without_login(client, db, local_mode):
    first = client.post('/v1/workspaces/local-access', json={})
    second = client.post('/v1/workspaces/local-access', json={})
    assert first.status_code == second.status_code == 200
    assert first.json()['data'] == second.json()['data']
    assert first.headers['cache-control'] == 'no-store'
    rows = list(db.scalars(select(Workspace)))
    assert len(rows) == 1
    assert rows[0].require_login is False
    assert rows[0].members == []


def test_local_mode_reuses_existing_workspace_and_grants_token_access(client, workspace, local_mode):
    response = client.post('/v1/workspaces/local-access', json={})
    assert response.status_code == 200
    access = response.json()['data']
    assert access['workspaceId'] == workspace['id']
    assert access['token'] == workspace['token']
    headers = {'X-Workspace-Token': access['token']}
    me = client.get(f"/v1/workspaces/{access['slug']}/me", headers=headers)
    assert me.status_code == 200
    assert me.json()['data']['effectiveRole'] == 'owner'
    assert me.json()['data']['authenticated'] is False


@pytest.mark.parametrize('key', ['id', 'slug'])
def test_local_mode_opens_clean_workspace_links(client, workspace, local_mode, key):
    response = client.post('/v1/workspaces/local-access', json={'workspace_id': workspace[key]})
    assert response.status_code == 200
    assert response.json()['data']['workspaceId'] == workspace['id']


def test_local_mode_chooses_most_recent_workspace(client, db, workspace, local_mode):
    old = db.get(Workspace, workspace['id'])
    old.created_at = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()
    new = client.post('/v1/workspaces', json={'name': 'Recent Workspace'}).json()['data']
    assert client.post('/v1/workspaces/local-access', json={}).json()['data']['workspaceId'] == new['workspaceId']


def test_local_mode_does_not_open_deleted_workspaces(client, db, workspace, local_mode):
    row = db.get(Workspace, workspace['id'])
    row.status = 'deleted'
    db.commit()
    response = client.post('/v1/workspaces/local-access', json={'workspace_id': workspace['slug']})
    assert response.status_code == 404
    assert response.json()['data'] is None


def test_local_mode_reports_missing_workspace_without_creating_one(client, db, local_mode):
    assert client.post('/v1/workspaces/local-access', json={'workspace_id': 'missing'}).status_code == 404
    assert list(db.scalars(select(Workspace))) == []
