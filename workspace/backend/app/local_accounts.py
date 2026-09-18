"""Local credentials and account-private execution networks."""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import unicodedata
import uuid

from sqlalchemy import select

from app.models import User, Workspace, WorkspaceMembership

logger = logging.getLogger(__name__)


def normalize_username(value):
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return json.dumps({"algorithm": "scrypt", "salt": base64.b64encode(salt).decode("ascii"), "digest": base64.b64encode(digest).decode("ascii")})


def verify_password(password, encoded):
    try:
        value = json.loads(encoded)
        if value["algorithm"] != "scrypt":
            return False
        salt = base64.b64decode(value["salt"], validate=True)
        expected = base64.b64decode(value["digest"], validate=True)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest, expected)
    except (ValueError, KeyError, TypeError):
        return False


def initialize_assistant(db, workspace):
    # An optional assistant must not invalidate the container/owner transaction.
    try:
        with db.begin_nested():
            from app.services.yumi import provision_yumi, seed_welcome_thread
            if provision_yumi(db, workspace):
                seed_welcome_thread(db, workspace)
    except Exception:
        logger.warning("Assistant initialization failed for %s", workspace.id, exc_info=True)


def create_container(db, user, name, kind="project", description="", template_id=None):
    workspace = Workspace(
        slug=secrets.token_hex(4), name=name, kind=kind,
        personal_owner_id=user.id if kind == "personal" else None,
        creator_email=user.email, password_hash=secrets.token_urlsafe(32),
        require_login=True, status="active",
        settings={"project": {"description": description, "template_id": template_id}} if kind == "project" else {},
    )
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role="owner"))
    db.flush()
    return workspace


def ensure_personal_space(db, user):
    # Serialize provisioning for the same account; the unique owner column is the final guard.
    db.execute(select(User).where(User.id == user.id).with_for_update()).scalar_one()
    space = db.execute(select(Workspace).where(Workspace.personal_owner_id == user.id)).scalar_one_or_none()
    if space is None:
        space = create_container(db, user, "Personal", kind="personal")
        initialize_assistant(db, space)
    return space


def new_local_user(username, password):
    user_id = str(uuid.uuid4())
    return User(id=user_id, username=normalize_username(username), display_name=username.strip(),
                email=f"{user_id}@local.invalid", local_password_hash=hash_password(password))
