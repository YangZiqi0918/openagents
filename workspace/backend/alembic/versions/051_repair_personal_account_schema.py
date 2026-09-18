"""Repair databases stamped 050 without its additive columns."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    workspace_columns = {column["name"] for column in inspector.get_columns("workspaces")}
    if "username" not in user_columns:
        op.add_column("users", sa.Column("username", sa.Text(), nullable=True))
    if "uq_users_username" not in {constraint["name"] for constraint in inspector.get_unique_constraints("users")}:
        op.create_unique_constraint("uq_users_username", "users", ["username"])
    if "local_password_hash" not in user_columns:
        op.add_column("users", sa.Column("local_password_hash", sa.Text(), nullable=True))
    if "kind" not in workspace_columns:
        op.add_column("workspaces", sa.Column("kind", sa.Text(), nullable=False, server_default="project"))
    if "personal_owner_id" not in workspace_columns:
        op.add_column("workspaces", sa.Column("personal_owner_id", postgresql.UUID(as_uuid=False), nullable=True))
    foreign_keys = {constraint["name"] for constraint in inspector.get_foreign_keys("workspaces")}
    if "fk_personal_space_owner" not in foreign_keys:
        op.create_foreign_key("fk_personal_space_owner", "workspaces", "users", ["personal_owner_id"], ["id"], ondelete="CASCADE")
    if "uq_personal_space_owner" not in {constraint["name"] for constraint in inspector.get_unique_constraints("workspaces")}:
        op.create_unique_constraint("uq_personal_space_owner", "workspaces", ["personal_owner_id"])


def downgrade():
    # 050 owns these columns; repairing a stamped database must not erase them.
    pass
