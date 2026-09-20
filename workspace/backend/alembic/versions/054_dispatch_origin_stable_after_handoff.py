"""Keep the original dispatch recipient as the idempotency key after handoff."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("kanban_tasks", sa.Column("dispatched_user_id", UUID(as_uuid=False), nullable=True))
    op.execute(sa.text("UPDATE kanban_tasks SET dispatched_user_id = responsible_user_id "
                       "WHERE plan_item_id IS NOT NULL AND responsible_user_id IS NOT NULL"))
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("kanban_tasks") as batch:
            batch.drop_constraint("uq_plan_dispatch_recipient_version", type_="unique")
            batch.create_unique_constraint("uq_plan_dispatch_recipient_version",
                                           ["plan_item_id", "source_version", "dispatched_user_id"])
    else:
        op.drop_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks", type_="unique")
        op.create_unique_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks",
                                    ["plan_item_id", "source_version", "dispatched_user_id"])


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("kanban_tasks") as batch:
            batch.drop_constraint("uq_plan_dispatch_recipient_version", type_="unique")
            batch.create_unique_constraint("uq_plan_dispatch_recipient_version",
                                           ["plan_item_id", "source_version", "responsible_user_id"])
    else:
        op.drop_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks", type_="unique")
        op.create_unique_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks",
                                    ["plan_item_id", "source_version", "responsible_user_id"])
    op.drop_column("kanban_tasks", "dispatched_user_id")
