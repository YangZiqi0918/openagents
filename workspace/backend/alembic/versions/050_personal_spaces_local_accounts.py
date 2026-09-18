"""Add local accounts and distinguish personal and project execution networks."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("username", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("local_password_hash", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    op.add_column("workspaces", sa.Column("kind", sa.Text(), nullable=False, server_default="project"))
    op.add_column("workspaces", sa.Column("personal_owner_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key("fk_personal_space_owner", "workspaces", "users", ["personal_owner_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_personal_space_owner", "workspaces", ["personal_owner_id"])


def downgrade():
    op.drop_constraint("uq_personal_space_owner", "workspaces", type_="unique")
    op.drop_constraint("fk_personal_space_owner", "workspaces", type_="foreignkey")
    op.drop_column("workspaces", "personal_owner_id")
    op.drop_column("workspaces", "kind")
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "local_password_hash")
    op.drop_column("users", "username")
