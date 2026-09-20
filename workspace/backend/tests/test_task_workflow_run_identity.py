"""Task workflow step delivery carries the owning task run identity."""

from sqlalchemy import select

from app.models import Channel, KanbanTask, User, WorkflowRun, Workspace
from app.services import workflow


def test_member_task_workflow_step_tags_current_run(db, workspace, monkeypatch):
    owner = db.execute(select(User).where(User.email == "test@example.com")).scalar_one()
    project = db.get(Workspace, workspace["id"])
    channel = Channel(workspace_id=project.id, name="task:workflow-run-identity", title="Review")
    task = KanbanTask(
        workspace_id=project.id, title="Review", description="", created_by=f"human:{owner.email}",
        responsible_user_id=owner.id, channel_name=channel.name, status="in_progress",
        execution_status="running", active_run_id="current-task-run",
    )
    run = WorkflowRun(
        workspace_id=project.id, workflow_id="template-1", channel_name=channel.name,
        current_step="draft", status="running", snapshot={"steps": [{
            "id": "draft", "name": "Draft", "instruction": "Write a draft",
            "assignee": {"kind": "agent", "agent": "agent-alpha"},
        }]},
    )
    db.add_all([channel, task, run])
    db.commit()
    emitted = []
    invoked = []
    monkeypatch.setattr(workflow, "_emit", lambda *_args, **kwargs: emitted.append(kwargs))
    monkeypatch.setattr(workflow, "_maybe_invoke_cloud_agent", lambda *_args, **kwargs: invoked.append(kwargs))

    workflow._deliver_step(db, project, run, run.snapshot["steps"][0], "")

    assert emitted[0]["metadata"] == {"workflow_step": "draft", "task_run_id": "current-task-run"}
    assert invoked[0]["task_run_id"] == "current-task-run"
