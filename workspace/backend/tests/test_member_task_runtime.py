"""Member-owned task channels keep delivery and execution separate."""

import asyncio

from sqlalchemy import select

from app.models import Channel, KanbanTask, NotificationRecord, User, WorkflowRun, Workspace, WorkspaceMembership
from app.mods import workspace_mod
from app.services import workflow
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext


def _task(db, workspace, *, status="in_progress", execution_status="running"):
    owner = db.execute(select(User).where(User.email == "test@example.com")).scalar_one()
    task = KanbanTask(
        id="member-task-1", workspace_id=workspace["id"], title="Prepare release",
        description="Write the notes", created_by=f"human:{owner.email}",
        responsible_user_id=owner.id, assignee="agent-alpha", status=status,
        execution_status=execution_status, active_run_id="run-1",
        channel_name="task:member-task-1",
    )
    channel = Channel(workspace_id=workspace["id"], name=task.channel_name, title=task.title)
    db.add_all([task, channel])
    db.commit()
    project = db.get(Workspace, workspace["id"])
    return task, channel, project, owner


def _message(channel, source, content, metadata=None):
    return Event(
        type="workspace.message.posted", source=source,
        target=f"channel/{channel.name}", payload={"content": content},
        metadata=metadata or {},
    )


def test_agent_result_updates_execution_not_review_column(db, workspace, monkeypatch):
    task, channel, project, owner = _task(db, workspace)
    notices = []
    monkeypatch.setattr(workspace_mod, "_classify_task_progress", lambda *_args: "done")
    import app.services.notify as notify_mod
    monkeypatch.setattr(notify_mod, "notify", lambda *_args, **kwargs: notices.append(kwargs))

    event = _message(channel, "openagents:agent-alpha", "Finished")
    workspace_mod._handle_task_thread_progress(event, channel, "Finished", db, project)
    db.flush()

    assert task.status == "in_progress"
    assert task.execution_status == "done"
    assert task.active_run_id is None
    assert notices[0]["recipient_user_id"] == owner.id


def test_in_progress_classification_keeps_execution_running(db, workspace, monkeypatch):
    task, channel, project, _owner = _task(db, workspace)
    monkeypatch.setattr(workspace_mod, "_classify_task_progress", lambda *_args: "in_progress")

    workspace_mod._handle_task_thread_progress(
        _message(channel, "openagents:agent-alpha", "Still working"),
        channel, "Still working", db, project,
    )
    assert task.execution_status == "running"
    task.execution_status = "in_progress"  # Previously persisted by the classifier.
    workspace_mod._handle_task_thread_progress(
        _message(channel, "openagents:agent-alpha", "Another update"),
        channel, "Another update", db, project,
    )
    assert task.execution_status == "running"


def test_other_member_comment_never_targets_the_task_agent(db, workspace, monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, "AUTH_MODE", "firebase")
    task, channel, project, owner = _task(db, workspace)
    commenter = User(email="other@example.com")
    db.add(commenter)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=commenter.id, role="member"))
    db.commit()

    event = _message(channel, f"human:{commenter.email}", "@agent-alpha please start")
    ctx = PipelineContext(network_id=workspace["id"], agent_address=event.source, db=db, workspace=project)
    routed = asyncio.run(workspace_mod._handle_message_posted(event, ctx))

    assert routed.metadata["task_comment"] is True
    assert routed.metadata["target_agents"] == ["__no_response__"]
    assert task.status == "in_progress"
    notice = db.execute(select(NotificationRecord).where(
        NotificationRecord.channel_name == task.channel_name,
        NotificationRecord.recipient_user_id == owner.id,
    )).scalar_one()
    assert notice.title == "Task comment"


def test_workflow_human_step_requires_explicit_owner_action(db, workspace, monkeypatch):
    task, channel, _project, owner = _task(db, workspace)
    task.workflow_id = "workflow-1"
    run = WorkflowRun(
        workspace_id=workspace["id"], workflow_id="workflow-1",
        channel_name=channel.name, current_step="review", status="running",
        snapshot={"name": "Review", "max_iterations": 2, "steps": [
            {"id": "review", "name": "Confirm", "instruction": "Confirm",
             "assignee": {"kind": "human", "human": owner.email}},
        ]},
    )
    db.add(run)
    db.commit()
    monkeypatch.setattr(workflow, "_emit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(workflow, "notify", lambda *_args, **_kwargs: None)

    base = {"target": f"channel/{channel.name}", "source": f"human:{owner.email}",
            "payload": {"content": "Confirmed"}}
    assert workflow.run_advance(db, workspace["id"], {**base, "metadata": {}}) is False
    assert workflow.run_advance(db, workspace["id"], {
        **base, "metadata": {"task_workflow_step_complete": True, "task_comment": True},
    }) is False
    assert workflow.run_advance(db, workspace["id"], {
        **base, "source": "human:other@example.com",
        "metadata": {"task_workflow_step_complete": True},
    }) is False
    assert workflow.run_advance(db, workspace["id"], {
        **base, "metadata": {"task_workflow_step_complete": True},
    }) is True
    assert task.status == "in_progress"
    assert task.execution_status == "done"
    assert run.status == "done"
