"""Persist explicit channel notification preferences without changing old joins."""

from alembic import op
import sqlalchemy as sa

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "channel_human_members",
        sa.Column("following", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    op.drop_column("channel_human_members", "following")
