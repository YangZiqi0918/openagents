"""Persist project plan items, assigned human tasks, and directed notifications."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "plan_items",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=False), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="todo"),
        sa.Column("assignees", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("priority", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("start_date", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Text(), nullable=True),
        sa.Column("attachments", JSONB(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("acceptance_criteria", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_plan_items_workspace", "plan_items", ["workspace_id"])
    op.add_column("kanban_tasks", sa.Column("source_version", sa.Integer(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("execution_status", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("active_run_id", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("acceptance_criteria", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("tags", JSONB(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("start_date", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("due_date", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("submission_history", JSONB(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("activity_history", JSONB(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("submitted_summary", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("decline_reason", sa.Text(), nullable=True))
    op.add_column("kanban_tasks", sa.Column("transfer_reason", sa.Text(), nullable=True))
    if op.get_bind().dialect.name == "sqlite":
        # SQLite cannot ALTER an existing table to add FK/unique constraints.
        with op.batch_alter_table("kanban_tasks") as batch:
            batch.add_column(sa.Column("plan_item_id", sa.Text(), sa.ForeignKey("plan_items.id", name="fk_kanban_plan_item", ondelete="SET NULL"), nullable=True))
            batch.add_column(sa.Column("responsible_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", name="fk_kanban_responsible_user", ondelete="SET NULL"), nullable=True))
            batch.add_column(sa.Column("transfer_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", name="fk_kanban_transfer_user", ondelete="SET NULL"), nullable=True))
            batch.create_unique_constraint("uq_plan_dispatch_recipient_version", ["plan_item_id", "source_version", "responsible_user_id"])
    else:
        op.add_column("kanban_tasks", sa.Column("plan_item_id", sa.Text(), sa.ForeignKey("plan_items.id", ondelete="SET NULL"), nullable=True))
        op.add_column("kanban_tasks", sa.Column("responsible_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        op.add_column("kanban_tasks", sa.Column("transfer_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        op.create_unique_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks", ["plan_item_id", "source_version", "responsible_user_id"])
    op.create_index("idx_kanban_workspace_responsible", "kanban_tasks", ["workspace_id", "responsible_user_id"])
    op.create_index("idx_kanban_plan_item", "kanban_tasks", ["plan_item_id"])
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("notifications") as batch:
            batch.add_column(sa.Column("recipient_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", name="fk_notification_recipient_user", ondelete="CASCADE"), nullable=True))
    else:
        op.add_column("notifications", sa.Column("recipient_user_id", UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True))
    op.create_index("idx_notifications_recipient", "notifications", ["recipient_user_id"])


def downgrade():
    op.drop_index("idx_notifications_recipient", table_name="notifications")
    op.drop_index("idx_kanban_plan_item", table_name="kanban_tasks")
    op.drop_index("idx_kanban_workspace_responsible", table_name="kanban_tasks")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("notifications") as batch:
            batch.drop_column("recipient_user_id")
        with op.batch_alter_table("kanban_tasks") as batch:
            batch.drop_constraint("uq_plan_dispatch_recipient_version", type_="unique")
            for name in ("transfer_user_id", "responsible_user_id", "plan_item_id"):
                batch.drop_column(name)
    else:
        op.drop_column("notifications", "recipient_user_id")
        op.drop_constraint("uq_plan_dispatch_recipient_version", "kanban_tasks", type_="unique")
        for name in ("transfer_user_id", "responsible_user_id", "plan_item_id"):
            op.drop_column("kanban_tasks", name)
    for name in (
        "transfer_reason", "decline_reason", "submitted_summary", "activity_history", "submission_history", "due_date",
        "start_date", "tags", "acceptance_criteria", "active_run_id", "execution_status",
        "source_version",
    ):
        op.drop_column("kanban_tasks", name)
    op.drop_index("idx_plan_items_workspace", table_name="plan_items")
    op.drop_table("plan_items")
