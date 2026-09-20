# -*- coding: utf-8 -*-
"""Kanban task endpoints — a workspace-wide, GitHub-issue-like board.

GET    /v1/tasks              List all tasks on the board
POST   /v1/tasks             Create a task (defaults to the Backlog column)
PATCH  /v1/tasks/{id}         Update a task (edit fields, drag between columns)
POST   /v1/tasks/{id}/assign  Assign to an agent → spins up the hidden thread
DELETE /v1/tasks/{id}         Delete a task (and archive its thread)

Distinct from `todos.py` (agent-private in-thread checklists). Assigning a task
creates a dedicated hidden `task:<id>` channel where the assigned agent does the
long-running work; a fast-model classifier in `workspace_mod` moves the card
between columns as the agent reports progress.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.access import resolve_current_user, resolve_user_role, verify_human_project_access
from app.config import config
from app.models import Channel, ChannelMember, KanbanTask, User, Workflow, Workspace, WorkspaceMember, WorkspaceMembership
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    _emit_event_blocking,
    _resolve_workspace,
    _verify_workspace_access,
)
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Tasks"])


# ---------------------------------------------------------------------------
# Columns / constants
# ---------------------------------------------------------------------------

# The Kanban columns, in board order. Kept in sync with the frontend.
TASK_STATUSES = ("backlog", "todo", "in_progress", "need_input", "done")
TASK_PRIORITIES = ("low", "normal", "medium", "high", "urgent")

# Hidden task threads share this channel-name prefix. The thread list and nav
# count filter these out (mirrors the `routines:` / `dm:` precedents), so a
# task's working thread never clutters the regular thread list.
TASK_CHANNEL_PREFIX = "task:"


def _task_channel_name(task_id: str) -> str:
    return f"{TASK_CHANNEL_PREFIX}{task_id}"


def _derive_title(description: str) -> str:
    """Preview title for an untitled task: the first few words + an ellipsis.

    Description is the primary field; the title is just how the card reads on
    the board, so a short prefix of the description is enough.
    """
    words = (description or "").split()
    if not words:
        return ""
    preview = " ".join(words[:8])
    truncated = len(words) > 8
    if len(preview) > 60:
        preview = preview[:60].rstrip()
        truncated = True
    return preview + ("…" if truncated else "")


def _bare_agent(name: Optional[str]) -> Optional[str]:
    """Normalize an agent reference to its bare name (strip `openagents:`).

    An empty/whitespace value returns None so callers can clear the assignee.
    """
    if not name:
        return None
    name = name.strip()
    if name.startswith("openagents:"):
        name = name[len("openagents:"):]
    return name or None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    status: str = "backlog"
    priority: str = "normal"
    assignee: Optional[str] = None  # pre-assign an agent WITHOUT running it
    workflow_id: Optional[str] = None  # run via a workflow instead of a single agent
    knowledge_ids: Optional[List[str]] = None  # knowledge entries attached as context
    file_ids: Optional[List[str]] = None  # workspace files attached (screenshots, docs)
    network: str
    source: Optional[str] = None  # "human:..." who created the card


class UpdateTaskRequest(BaseModel):
    network: str
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    position: Optional[int] = None
    # Set/change the assigned agent WITHOUT running it. "" clears the assignee.
    assignee: Optional[str] = None
    # Assign the task to a workflow ("" clears it, back to single-agent).
    workflow_id: Optional[str] = None
    # Replace the attached knowledge context ([] clears; None = untouched).
    knowledge_ids: Optional[List[str]] = None
    # Replace the attached files ([] clears; None = untouched).
    file_ids: Optional[List[str]] = None


class AssignTaskRequest(BaseModel):
    network: str
    agent: Optional[str] = None      # bare agent to run; falls back to task.assignee
    source: Optional[str] = None     # human who ran it (for the kickoff message)


class TaskActionRequest(BaseModel):
    network: str


class ConfigureTaskRequest(TaskActionRequest):
    mode: str  # manual | agent | workflow
    agent: Optional[str] = None
    workflow_id: Optional[str] = None
    knowledge_ids: Optional[List[str]] = None
    file_ids: Optional[List[str]] = None


class DeclineTaskRequest(TaskActionRequest):
    reason: str


class SubmitTaskRequest(TaskActionRequest):
    summary: str
    file_ids: Optional[List[str]] = None


class TransferTaskRequest(TaskActionRequest):
    user_id: str
    reason: str
    force: bool = False


class CompleteStepRequest(TaskActionRequest):
    content: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_knowledge_ids(db: Session, workspace_id: str, ids: Optional[List[str]]) -> Optional[list]:
    """Keep only ids that are real, active knowledge entries of this workspace."""
    from app.models import KnowledgeEntry

    wanted = [i for i in (ids or []) if isinstance(i, str) and i.strip()]
    if not wanted:
        return None
    rows = db.execute(
        select(KnowledgeEntry.id).where(
            KnowledgeEntry.workspace_id == workspace_id,
            KnowledgeEntry.id.in_(wanted),
            KnowledgeEntry.status == "active",
        )
    ).scalars().all()
    valid = set(rows)
    cleaned = [i for i in wanted if i in valid]  # preserve selection order
    return cleaned or None


def _clean_file_ids(db: Session, workspace_id: str, ids: Optional[List[str]]) -> Optional[list]:
    """Keep only ids that are real, active files of this workspace."""
    from app.models import FileRecord

    wanted = [i for i in (ids or []) if isinstance(i, str) and i.strip()]
    if not wanted:
        return None
    rows = db.execute(
        select(FileRecord.id).where(
            FileRecord.workspace_id == workspace_id,
            FileRecord.id.in_(wanted),
            FileRecord.status == "active",
        )
    ).scalars().all()
    valid = set(rows)
    cleaned = [i for i in wanted if i in valid]  # preserve selection order
    return cleaned or None


def _reference_error(db: Session, workspace, *, assignee=None, workflow_id=None,
                     knowledge_ids=None, file_ids=None) -> Optional[str]:
    if config.AUTH_MODE != "local_password" and workspace.kind != "personal":
        return None
    agent = _bare_agent(assignee)
    if agent and db.execute(select(WorkspaceMember.agent_name).where(
        WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.agent_name == agent,
        WorkspaceMember.status != "removed",
    )).first() is None:
        return "Assignee does not belong to this project"
    if workflow_id and db.execute(select(Workflow.id).where(
        Workflow.workspace_id == workspace.id, Workflow.id == workflow_id,
    )).first() is None:
        return "Workflow does not belong to this project"
    if knowledge_ids and set(knowledge_ids) != set(_clean_knowledge_ids(db, str(workspace.id), knowledge_ids) or []):
        return "Knowledge entry does not belong to this project"
    if file_ids and set(file_ids) != set(_clean_file_ids(db, str(workspace.id), file_ids) or []):
        return "File does not belong to this project"
    return None


def _task_attachments(db: Session, workspace_id: str, task: KanbanTask) -> list:
    """Attachment dicts for the task's files, in the shape chat messages use
    (see cloud_agent._post_response), so agents/clients render them the same."""
    from app.models import FileRecord

    if not task.file_ids:
        return []
    rows = db.execute(
        select(FileRecord).where(
            FileRecord.workspace_id == workspace_id,
            FileRecord.id.in_(task.file_ids),
            FileRecord.status == "active",
        )
    ).scalars().all()
    by_id = {r.id: r for r in rows}
    return [
        {
            "file_id": r.id,
            "filename": r.filename,
            "content_type": r.content_type,
            "size": r.size,
        }
        for r in (by_id[i] for i in task.file_ids if i in by_id)
    ]


def _context_block(db: Session, workspace_id: str, task: KanbanTask) -> str:
    """Render the task's attached knowledge as a kickoff context section.

    Entries are referenced as @knowledge:<slug> — the same convention the chat
    composer uses — so agents resolve them with their knowledge tool.
    """
    from app.models import KnowledgeEntry

    if not task.knowledge_ids:
        return ""
    rows = db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.workspace_id == workspace_id,
            KnowledgeEntry.id.in_(task.knowledge_ids),
            KnowledgeEntry.status == "active",
        )
    ).scalars().all()
    if not rows:
        return ""
    by_id = {r.id: r for r in rows}
    ordered = [by_id[i] for i in task.knowledge_ids if i in by_id]
    lines = "\n".join(f"- “{r.title}” → @knowledge:{r.slug}" for r in ordered)
    return (
        "\n\nContext documents — read each with your knowledge tool before "
        f"starting:\n{lines}"
    )


def _serialize_task(t: KanbanTask, run: Optional[dict] = None, last_message: Optional[str] = None) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "assignee": t.assignee,
        "workflow_id": t.workflow_id,
        "knowledge_ids": t.knowledge_ids or [],
        "file_ids": t.file_ids or [],
        "plan_item_id": t.plan_item_id,
        "responsible_user_id": t.responsible_user_id,
        "dispatched_user_id": t.dispatched_user_id,
        "source_version": t.source_version,
        "execution_status": t.execution_status,
        "active_run_id": t.active_run_id,
        "acceptance_criteria": t.acceptance_criteria,
        "tags": t.tags or [],
        "start_date": t.start_date,
        "due_date": t.due_date,
        "submission_history": t.submission_history or [],
        "activity_history": t.activity_history or [],
        "submitted_summary": t.submitted_summary,
        "decline_reason": t.decline_reason,
        "transfer_user_id": t.transfer_user_id,
        "transfer_reason": t.transfer_reason,
        "created_by": t.created_by,
        "channel_name": t.channel_name,
        "priority": t.priority,
        "position": t.position,
        # Live workflow-run summary (step X of N, who's on it) — only for
        # workflow tasks with a run; see workflow.run_info.
        "run": run,
        # Latest chat message in the thread — surfaced on need_input cards so
        # the human can see the question without opening the popup.
        "last_message": last_message,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _enrich(db: Session, workspace_id: str, tasks_list: list) -> list:
    """Serialize tasks with run summaries + need-input snippets, batched.

    One query for all runs, one for the latest chat message per need-input
    channel — not a query per task.
    """
    from app.models import EventRecord, WorkflowRun
    from app.services.workflow import run_info

    wf_channels = [t.channel_name for t in tasks_list if t.workflow_id and t.channel_name]
    runs_by_channel: dict = {}
    if wf_channels:
        runs = db.execute(
            select(WorkflowRun).where(
                WorkflowRun.workspace_id == workspace_id,
                WorkflowRun.channel_name.in_(wf_channels),
            ).order_by(WorkflowRun.created_at.asc())
        ).scalars().all()
        for r in runs:  # ascending → the latest run per channel wins
            runs_by_channel[r.channel_name] = r

    # Snippets: need_input cards show the last *chat* line (the question);
    # in_progress cards show the latest activity of any kind (chat, status
    # tool-lines, thinking) so the human sees what the agent is doing.
    question_channels = {t.channel_name for t in tasks_list if t.status == "need_input" and t.channel_name}
    activity_channels = {t.channel_name for t in tasks_list if t.status == "in_progress" and t.channel_name}
    last_by_channel: dict = {}
    if question_channels or activity_channels:
        targets = [f"channel/{c}" for c in question_channels | activity_channels]
        events = db.execute(
            select(EventRecord).where(
                EventRecord.network_id == workspace_id,
                EventRecord.type == "workspace.message.posted",
                EventRecord.target.in_(targets),
            ).order_by(EventRecord.timestamp.asc())
        ).scalars().all()
        for e in events:  # ascending → the last qualifying message per channel wins
            channel = e.target[len("channel/"):]
            msg_type = (e.payload or {}).get("message_type", "chat")
            content = (e.payload or {}).get("content") or ""
            if not content:
                continue
            if channel in question_channels and msg_type == "chat":
                last_by_channel[channel] = content[:280]
            elif channel in activity_channels and msg_type in ("chat", "status", "thinking"):
                last_by_channel[channel] = content[:280]

    return [
        _serialize_task(
            t,
            run=run_info(runs_by_channel.get(t.channel_name)) if t.channel_name else None,
            last_message=last_by_channel.get(t.channel_name) if t.channel_name else None,
        )
        for t in tasks_list
    ]


def _next_position(db: Session, workspace_id: str, status: str) -> int:
    """Append to the bottom of the target column."""
    rows = db.execute(
        select(KanbanTask.position).where(
            KanbanTask.workspace_id == workspace_id,
            KanbanTask.status == status,
        )
    ).scalars().all()
    return (max(rows) + 1) if rows else 0


def _kickoff_message(task: KanbanTask, agent: str, context: str = "") -> str:
    """The first message posted into the task thread when an agent is assigned.

    Frames the work as a long-running task and tells the agent the board's
    column semantics so its replies classify cleanly (the fast-model
    classifier in workspace_mod reads these replies to move the card).
    """
    desc = task.description.strip()
    body = f"\n\n{desc}" if desc else ""
    return (
        f"@{agent} You've been assigned this Kanban task. Work on it to "
        f"completion — this is a long-running task.\n\n"
        f"**{task.title}**{body}{context}\n\n"
        f"When you need information or a decision from a human to continue, "
        f"say so clearly and end your message asking for that input — the "
        f"board will move the card to **Need Input** and notify the team. "
        f"When the task is fully finished, say so clearly and the card moves "
        f"to **Done**. Otherwise keep working and posting progress here."
    )


def _member_kickoff_message(task: KanbanTask, agent: str, context: str = "") -> str:
    return (
        f"@{agent} Help the assigned project member with this task:\n\n"
        f"**{task.title}**\n\n{task.description}{context}\n\n"
        "Post progress, blockers, and your final result in this task conversation. "
        "The member remains responsible for submitting the work for administrator review; "
        "your reply does not complete or submit the task."
    )


def _add_channel_agent(db: Session, channel: Channel, agent: str):
    if db.execute(select(ChannelMember).where(
        ChannelMember.channel_id == channel.id, ChannelMember.agent_name == agent,
    )).scalar_one_or_none() is None:
        db.add(ChannelMember(channel_id=channel.id, agent_name=agent))


# ---------------------------------------------------------------------------
# GET /v1/tasks
# ---------------------------------------------------------------------------

@router.get("/tasks")
def list_tasks(
    network: str = Query(...),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List all Kanban tasks for the workspace board."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(KanbanTask).where(KanbanTask.workspace_id == str(workspace.id))
    if workspace.kind == "project" and authorization is not None:
        user = resolve_current_user(db, authorization)
        if user is None:
            return json_response(ResponseCode.UNAUTHORIZED, "Identity required")
        filters = [KanbanTask.responsible_user_id == user.id, KanbanTask.transfer_user_id == user.id]
        if resolve_user_role(db, workspace, authorization) in {"owner", "admin"}:
            # Old unowned cards wait in the administrator's organization queue.
            filters.append(KanbanTask.responsible_user_id.is_(None))
        query = query.where(or_(*filters))
    elif workspace.kind == "project":
        query = query.where(KanbanTask.responsible_user_id.is_(None))
    if status:
        query = query.where(KanbanTask.status == status)
    query = query.order_by(KanbanTask.status, KanbanTask.position, KanbanTask.created_at)
    rows = db.execute(query).scalars().all()

    return success_response({"tasks": _enrich(db, str(workspace.id), list(rows))})


@router.get("/tasks/{task_id}")
def get_task(task_id: str, network: str = Query(...), db: Session = Depends(get_db),
             x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    task = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.id == task_id,
    )).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")
    return success_response(_enrich(db, str(workspace.id), [task])[0])


# ---------------------------------------------------------------------------
# POST /v1/tasks
# ---------------------------------------------------------------------------

@router.post("/tasks")
def create_task(
    body: CreateTaskRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Create a task card (defaults to the Backlog column)."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    if workspace.kind == "project" and authorization is not None and not verify_human_project_access(
        db, workspace, authorization, "admin"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Only administrators may create project tasks")
    error = _reference_error(db, workspace, assignee=body.assignee, workflow_id=body.workflow_id,
                             knowledge_ids=body.knowledge_ids, file_ids=body.file_ids)
    if error:
        return json_response(ResponseCode.BAD_REQUEST, error)

    # Description is the primary field; the title is optional and, when
    # omitted, previews the description's first few words.
    description = (body.description or "").strip()
    title = (body.title or "").strip() or _derive_title(description)
    if not title:
        return json_response(ResponseCode.BAD_REQUEST, "a title or a description is required")
    status = body.status if body.status in TASK_STATUSES else "backlog"
    priority = body.priority if body.priority in TASK_PRIORITIES else "normal"

    task = KanbanTask(
        workspace_id=str(workspace.id),
        title=title,
        description=description,
        status=status,
        priority=priority,
        # Pre-assigning an agent (or workflow) here only records who *will* run
        # it — it does NOT start the work. Execution happens via POST /assign (Run).
        assignee=_bare_agent(body.assignee),
        workflow_id=(body.workflow_id or None),
        knowledge_ids=_clean_knowledge_ids(db, str(workspace.id), body.knowledge_ids),
        file_ids=_clean_file_ids(db, str(workspace.id), body.file_ids),
        created_by=(f"human:{resolve_current_user(db, authorization).email}"
                    if authorization is not None and (config.AUTH_MODE == "local_password" or workspace.kind == "personal")
                    else body.source or "human:user"),
        position=_next_position(db, str(workspace.id), status),
    )
    db.add(task)
    db.commit()

    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# PATCH /v1/tasks/{task_id}
# ---------------------------------------------------------------------------

@router.patch("/tasks/{task_id}")
def update_task(
    body: UpdateTaskRequest,
    task_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update task fields — edit text, move columns, or set the assignee.

    Setting ``assignee`` here only records who will run the task; it does NOT
    start the work (no thread, no kickoff). Execution is triggered separately
    by POST /v1/tasks/{id}/assign (the board's "Run" button).
    """
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    if workspace.kind == "project" and authorization is not None and not verify_human_project_access(
        db, workspace, authorization, "admin"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Only administrators may edit unassigned project tasks")

    task = db.execute(
        select(KanbanTask).where(
            KanbanTask.id == task_id,
            KanbanTask.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")
    if task.responsible_user_id:
        return json_response(ResponseCode.FORBIDDEN, "Use member task actions instead of changing dispatched task fields")
    error = _reference_error(db, workspace, assignee=body.assignee, workflow_id=body.workflow_id,
                             knowledge_ids=body.knowledge_ids, file_ids=body.file_ids)
    if error:
        return json_response(ResponseCode.BAD_REQUEST, error)

    # Description first — a cleared title derives its preview from the
    # (possibly just-updated) description.
    if body.description is not None:
        task.description = body.description.strip()
    if body.title is not None:
        title = body.title.strip()
        task.title = title or _derive_title(task.description) or task.title
    if body.priority is not None and body.priority in TASK_PRIORITIES:
        task.priority = body.priority
    if body.status is not None and body.status in TASK_STATUSES:
        # Moving to a new column: append to the bottom unless an explicit
        # position is supplied.
        if body.status != task.status and body.position is None:
            task.position = _next_position(db, str(workspace.id), body.status)
        # Stopping a workflow task (→ backlog) must pause its run, or a late
        # agent reply would advance the run and yank the card back.
        if body.status == "backlog" and task.workflow_id and task.channel_name:
            from app.services.workflow import pause_run
            pause_run(db, str(workspace.id), task.channel_name)
        task.status = body.status
    if body.position is not None:
        task.position = body.position
    if body.assignee is not None:
        # "" clears the assignee; a name (bare or openagents:) sets it.
        task.assignee = _bare_agent(body.assignee)
    if body.workflow_id is not None:
        # "" clears (back to single-agent); a value assigns the task to a workflow.
        task.workflow_id = body.workflow_id or None
    if body.knowledge_ids is not None:
        # [] clears the attached context; a list replaces it (validated).
        task.knowledge_ids = _clean_knowledge_ids(db, str(workspace.id), body.knowledge_ids)
    if body.file_ids is not None:
        task.file_ids = _clean_file_ids(db, str(workspace.id), body.file_ids)

    db.commit()
    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# POST /v1/tasks/{task_id}/assign
# ---------------------------------------------------------------------------

def _run_workflow_task(db, workspace, task, human_source: str, token: Optional[str]):
    """Start a WorkflowRun for a task assigned to a workflow (the "Run" action).

    Creates the hidden task thread (with all agent-step agents as participants),
    then hands off to the engine to deliver step 1. Moving the card through
    columns is owned by the workflow engine from here on.
    """
    from app.services.workflow import resume_or_restart

    workflow = db.execute(
        select(Workflow).where(
            Workflow.id == task.workflow_id,
            Workflow.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not workflow:
        return json_response(ResponseCode.NOT_FOUND, "Workflow not found")
    if not (workflow.steps or []):
        return json_response(ResponseCode.BAD_REQUEST, "workflow has no steps")
    if task.responsible_user_id:
        owner = db.get(User, task.responsible_user_id)
        if owner is None or not _workflow_allowed_for_owner(db, workspace.id, workflow, owner):
            return json_response(ResponseCode.CONFLICT, "Reconfigure workflow steps for the current task owner")

    channel_name = task.channel_name or _task_channel_name(task.id)

    # Create the hidden thread if it doesn't exist yet, seeding it with every
    # agent that appears as a step assignee.
    existing_channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if existing_channel is None:
        agents = []
        for step in workflow.steps:
            a = (step.get("assignee") or {})
            if a.get("kind") == "agent" and a.get("agent") and a["agent"] not in agents:
                agents.append(a["agent"])
        create_evt = Event(
            type="network.channel.create",
            source=human_source,
            target="core",
            payload={
                "name": channel_name,
                "title": task.title,
                "participants": agents or ["__no_response__"],
            },
            metadata={},
        )
        if _emit_event_blocking(create_evt, workspace, db, token=token) is None:
            return json_response(ResponseCode.FORBIDDEN, "Unable to create the task execution channel")

    task.channel_name = channel_name
    if task.responsible_user_id:
        task.active_run_id = str(uuid4())
        task.execution_status = "running"
    else:
        task.status = "in_progress"
        task.position = _next_position(db, str(workspace.id), "in_progress")
    db.flush()

    # Run semantics: no-op if already running, resume a paused run (re-deliver
    # the current step), or start fresh when the last run finished/was stopped.
    prev = task.title + (f"\n\n{task.description}" if task.description else "") \
        + _context_block(db, str(workspace.id), task)
    resume_or_restart(
        db, workspace, channel_name, workflow, prev,
        attachments=_task_attachments(db, str(workspace.id), task),
    )

    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/assign")
def assign_task(
    body: AssignTaskRequest,
    task_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Run a task on an agent — creates the hidden thread and kicks it off.

    This is the board's "Run" action. The agent comes from the request body or,
    if omitted, the task's pre-set ``assignee``. We (1) create (or reuse) the
    ``task:<id>`` channel with the agent as master + participant, (2) post a
    kickoff message that routes to the agent and starts the long-running work,
    and (3) move the card to In Progress.
    """
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    task = db.execute(
        select(KanbanTask).where(
            KanbanTask.id == task_id,
            KanbanTask.workspace_id == str(workspace.id),
        ).with_for_update()
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")
    if task.responsible_user_id:
        if not verify_human_project_access(db, workspace, authorization, "member"):
            return json_response(ResponseCode.FORBIDDEN, "Member identity required")
        actor = resolve_current_user(db, authorization)
        role = resolve_user_role(db, workspace, authorization)
        if actor is None or (actor.id != task.responsible_user_id and role not in {"owner", "admin"}):
            return json_response(ResponseCode.FORBIDDEN, "Only the task owner or administrator may run it")
        if task.status != "in_progress" or task.transfer_user_id:
            return json_response(ResponseCode.CONFLICT, "Accept the task before running it")
        if task.execution_status == "running":
            return success_response(_serialize_task(task))
        if not task.workflow_id and (
            not task.assignee or (body.agent is not None and _bare_agent(body.agent) != task.assignee)
        ):
            return json_response(ResponseCode.CONFLICT, "Configure the task agent before running it")
    elif workspace.kind == "project" and authorization is not None and not verify_human_project_access(
        db, workspace, authorization, "admin"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Only administrators may run unassigned project tasks")

    # ── Workflow task: start a WorkflowRun instead of a single-agent kickoff ──
    if task.workflow_id:
        workflow_source = f"human:{actor.email}" if task.responsible_user_id else (body.source or "human:user")
        return _run_workflow_task(db, workspace, task, workflow_source, x_workspace_token)

    # Agent to run: explicit in the request, else the task's pre-set assignee.
    agent = _bare_agent(body.agent) or _bare_agent(task.assignee)
    if not agent:
        return json_response(ResponseCode.BAD_REQUEST, "no agent to run: assign one first")

    # The agent must actually be a member of this workspace.
    is_member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent,
            WorkspaceMember.status != "removed",
        )
    ).scalar_one_or_none()
    if not is_member:
        return json_response(
            ResponseCode.FORBIDDEN,
            f"agent '{agent}' is not a member of this workspace",
        )

    human_source = f"human:{actor.email}" if task.responsible_user_id else (body.source or "human:user")
    channel_name = task.channel_name or _task_channel_name(task.id)

    # 1. Create the hidden task channel (idempotent — reuse if it exists).
    existing_channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if existing_channel is None:
        create_evt = Event(
            type="network.channel.create",
            source=human_source,
            target="core",
            payload={
                "name": channel_name,
                "title": task.title,
                "master": agent,
                "participants": [agent],
            },
            metadata={},
        )
        if _emit_event_blocking(create_evt, workspace, db, token=x_workspace_token) is None:
            return json_response(ResponseCode.FORBIDDEN, "Unable to create the task execution channel")
    else:
        # Reassignment — point the existing channel at the new agent.
        existing_channel.master_agent = agent
        if task.responsible_user_id and is_member.agent_type == "cloud:openagents":
            _add_channel_agent(db, existing_channel, agent)
            db.flush()

    # 2. Post the kickoff message (routes to the agent, starts the work).
    if task.responsible_user_id:
        task.active_run_id = str(uuid4())
        task.execution_status = "running"
    kickoff = Event(
        type="workspace.message.posted",
        source=human_source,
        target=f"channel/{channel_name}",
        payload={
            "content": (_member_kickoff_message if task.responsible_user_id else _kickoff_message)(
                task, agent, _context_block(db, str(workspace.id), task)
            ),
            "message_type": "chat",
            **({"attachments": atts} if (atts := _task_attachments(db, str(workspace.id), task)) else {}),
        },
        metadata={"target_agents": [agent], **({"task_run_id": task.active_run_id} if task.responsible_user_id else {})},
    )
    if _emit_event_blocking(kickoff, workspace, db, token=x_workspace_token) is None:
        if task.responsible_user_id:
            task.active_run_id = None
            task.execution_status = "paused"
        return json_response(ResponseCode.FORBIDDEN, "Unable to start the task")

    # 3. Move the card to In Progress.
    task.assignee = agent
    task.channel_name = channel_name
    if not task.responsible_user_id:
        task.status = "in_progress"
        task.position = _next_position(db, str(workspace.id), "in_progress")

    db.commit()
    return success_response(_serialize_task(task))


# ---------------------------------------------------------------------------
# DELETE /v1/tasks/{task_id}
# ---------------------------------------------------------------------------

@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Delete a task and archive its working thread, if any."""
    task = db.execute(
        select(KanbanTask).where(KanbanTask.id == task_id)
    ).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == task.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    if task.responsible_user_id:
        return json_response(ResponseCode.FORBIDDEN, "Dispatched tasks cannot be deleted")
    if workspace.kind == "project" and authorization is not None and not verify_human_project_access(
        db, workspace, authorization, "admin"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Only administrators may delete unassigned project tasks")

    # Archive the linked thread so it stops appearing anywhere, and kill any
    # live workflow run so the engine can't keep acting on a deleted task.
    if task.channel_name:
        channel = db.execute(
            select(Channel).where(
                Channel.workspace_id == workspace.id,
                Channel.name == task.channel_name,
            )
        ).scalar_one_or_none()
        if channel is not None:
            channel.status = "deleted"
        from app.services.workflow import cancel_run
        cancel_run(db, str(workspace.id), task.channel_name)

    db.delete(task)
    db.commit()
    return success_response({"id": task_id, "status": "deleted"})


def _member_task(db: Session, network: str, task_id: str, authorization: Optional[str]):
    workspace = _resolve_workspace(db, network)
    if workspace is None or workspace.kind != "project" or workspace.status == "deleted":
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Project not found")
    if not verify_human_project_access(db, workspace, authorization, "member"):
        return None, None, None, json_response(ResponseCode.FORBIDDEN, "Project membership required")
    user = resolve_current_user(db, authorization)
    if user is None:
        return None, None, None, json_response(ResponseCode.UNAUTHORIZED, "Identity required")
    task = db.execute(select(KanbanTask).where(
        KanbanTask.id == task_id, KanbanTask.workspace_id == workspace.id,
    ).with_for_update()).scalar_one_or_none()
    if task is None or not task.responsible_user_id:
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Member task not found")
    return workspace, task, user, None


def _owner(task: KanbanTask, user: User) -> bool:
    return task.responsible_user_id == user.id


def _log_activity(task: KanbanTask, action: str, actor: User, **fields):
    task.activity_history = [*(task.activity_history or []), {
        "action": action, "actor_user_id": actor.id,
        "at": datetime.now(timezone.utc).isoformat(), **fields,
    }]


def _workflow_allowed_for_owner(db: Session, workspace_id: str, workflow: Workflow, owner: User) -> bool:
    valid = {str(owner.id), owner.email.lower()}
    if owner.username:
        valid.add(owner.username.lower())
    agents = set(db.execute(select(WorkspaceMember.agent_name).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status != "removed",
    )).scalars())
    for step in (workflow.steps or []):
        assignee = step.get("assignee") or {}
        if assignee.get("kind") == "agent" and assignee.get("agent") not in agents:
            return False
        if assignee.get("kind") == "human" and (assignee.get("human") or "").strip().lower() not in (valid | {""}):
            return False
    return True


def _pause_execution(db: Session, workspace: Workspace, task: KanbanTask, *, cancel_workflow: bool = False):
    old_run, agent = task.active_run_id, task.assignee
    if task.channel_name and task.workflow_id:
        from app.services.workflow import cancel_run, pause_run
        (cancel_run if cancel_workflow else pause_run)(db, str(workspace.id), task.channel_name)
    if old_run:
        task.execution_status = "paused"
    task.active_run_id = None
    return (old_run, agent) if old_run and agent else (None, None)


def _signal_stop(workspace: Workspace, db: Session, task: KanbanTask, run_id: Optional[str], agent: Optional[str]):
    if not run_id or not agent or not task.channel_name:
        return
    event = Event(type="workspace.agent.control", source="system:task",
                  target=f"openagents:{agent}",
                  payload={"action": "stop", "channel": task.channel_name},
                  metadata={"task_run_id": run_id})
    try:
        _emit_event_blocking(event, workspace, db)
    except Exception:
        logger.warning("Task %s stopped in DB but control event failed", task.id, exc_info=True)


def _task_admins(db: Session, workspace_id: str):
    return db.execute(select(WorkspaceMembership.user_id).where(
        WorkspaceMembership.workspace_id == workspace_id,
        WorkspaceMembership.role.in_(("owner", "admin")),
    )).scalars().all()


@router.post("/tasks/{task_id}/configure")
def configure_member_task(body: ConfigureTaskRequest, task_id: str,
                          db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor):
        return json_response(ResponseCode.FORBIDDEN, "Only the task owner may configure execution")
    if task.transfer_user_id or task.decline_reason or task.status not in {"backlog", "in_progress"}:
        return json_response(ResponseCode.CONFLICT, "Task cannot be configured in its current state")
    if task.execution_status == "running":
        return json_response(ResponseCode.CONFLICT, "Stop execution before changing its configuration")
    if body.mode == "manual":
        task.assignee = None
        task.workflow_id = None
    elif body.mode == "agent":
        agent = _bare_agent(body.agent)
        if not agent or db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent,
            WorkspaceMember.status != "removed",
        )).scalar_one_or_none() is None:
            return json_response(ResponseCode.BAD_REQUEST, "Choose an available project agent")
        task.assignee, task.workflow_id = agent, None
    elif body.mode == "workflow":
        workflow = db.execute(select(Workflow).where(
            Workflow.id == body.workflow_id, Workflow.workspace_id == workspace.id,
        )).scalar_one_or_none()
        if workflow is None or not (workflow.steps or []) or not _workflow_allowed_for_owner(db, workspace.id, workflow, actor):
            return json_response(ResponseCode.BAD_REQUEST, "Choose a workflow with project agents and your own human steps")
        task.workflow_id, task.assignee = workflow.id, None
    else:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid execution mode")
    if body.knowledge_ids is not None:
        if set(body.knowledge_ids) != set(_clean_knowledge_ids(db, workspace.id, body.knowledge_ids) or []):
            return json_response(ResponseCode.BAD_REQUEST, "Knowledge entry does not belong to this project")
        task.knowledge_ids = _clean_knowledge_ids(db, workspace.id, body.knowledge_ids)
    if body.file_ids is not None:
        if set(body.file_ids) != set(_clean_file_ids(db, workspace.id, body.file_ids) or []):
            return json_response(ResponseCode.BAD_REQUEST, "File does not belong to this project")
        task.file_ids = _clean_file_ids(db, workspace.id, body.file_ids)
    _log_activity(task, "configured", actor, mode=body.mode)
    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/accept")
def accept_member_task(body: TaskActionRequest, task_id: str,
                       db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor):
        return json_response(ResponseCode.FORBIDDEN, "Only the task owner may accept it")
    if task.status != "backlog" or task.decline_reason or task.transfer_user_id:
        return json_response(ResponseCode.CONFLICT, "Task is not awaiting acceptance")
    task.status = "in_progress"
    task.position = _next_position(db, workspace.id, "in_progress")
    task.execution_status = "idle"
    _log_activity(task, "accepted", actor)
    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/decline")
def decline_member_task(body: DeclineTaskRequest, task_id: str,
                        db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor):
        return json_response(ResponseCode.FORBIDDEN, "Only the task owner may decline it")
    if task.status != "backlog" or task.decline_reason or task.transfer_user_id:
        return json_response(ResponseCode.CONFLICT, "Task is not awaiting acceptance")
    reason = body.reason.strip()
    if not reason:
        return json_response(ResponseCode.BAD_REQUEST, "A reason is required")
    task.decline_reason = reason
    _log_activity(task, "declined", actor, reason=reason)
    from app.services.notify import notify
    for user_id in _task_admins(db, workspace.id):
        notify(db, workspace.id, source=f"human:{actor.email}", title="Task declined",
               message=f"{task.title}: {reason}", channel_name=task.channel_name,
               recipient_user_id=user_id, reason="approval")
    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/submit")
def submit_member_task(body: SubmitTaskRequest, task_id: str,
                       db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor):
        return json_response(ResponseCode.FORBIDDEN, "Only the task owner may submit it")
    if task.status != "in_progress" or task.transfer_user_id:
        return json_response(ResponseCode.CONFLICT, "Task is not in progress")
    summary = body.summary.strip()
    if not summary:
        return json_response(ResponseCode.BAD_REQUEST, "A result summary is required")
    files = body.file_ids or []
    if set(files) != set(_clean_file_ids(db, workspace.id, files) or []):
        return json_response(ResponseCode.BAD_REQUEST, "File does not belong to this project")
    run_id, agent = _pause_execution(db, workspace, task)
    task.submitted_summary = summary
    task.submission_history = [*(task.submission_history or []), {
        "summary": summary, "file_ids": files, "user_id": actor.id,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }]
    task.status = "need_input"
    task.position = _next_position(db, workspace.id, "need_input")
    _log_activity(task, "submitted", actor)
    from app.services.notify import notify
    for user_id in _task_admins(db, workspace.id):
        notify(db, workspace.id, source=f"human:{actor.email}", title="Task awaiting review",
               message=task.title, channel_name=task.channel_name,
               link_url=f"/projects/{workspace.id}?tab=plan&item={task.plan_item_id}",
               recipient_user_id=user_id, reason="approval")
    db.commit()
    _signal_stop(workspace, db, task, run_id, agent)
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/stop")
def stop_member_task(body: TaskActionRequest, task_id: str,
                     db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor) and resolve_user_role(db, workspace, authorization) not in {"owner", "admin"}:
        return json_response(ResponseCode.FORBIDDEN, "Only the task owner or administrator may stop it")
    if task.status != "in_progress" or task.execution_status not in {"running", "need_input"}:
        return json_response(ResponseCode.CONFLICT, "Task is not in progress")
    run_id, agent = _pause_execution(db, workspace, task)
    _log_activity(task, "execution_stopped", actor)
    db.commit()
    _signal_stop(workspace, db, task, run_id, agent)
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/transfer")
def request_task_transfer(body: TransferTaskRequest, task_id: str,
                          db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if resolve_user_role(db, workspace, authorization) not in {"owner", "admin"}:
        return json_response(ResponseCode.FORBIDDEN, "Administrator access required")
    try:
        target_id = str(UUID(body.user_id))
    except ValueError:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid member ID")
    target = db.get(WorkspaceMembership, (workspace.id, target_id))
    if target is None or target.role == "viewer" or target_id == task.responsible_user_id:
        return json_response(ResponseCode.BAD_REQUEST, "Choose a different project member")
    if task.transfer_user_id:
        return json_response(ResponseCode.CONFLICT, "Task transfer is already pending")
    if body.force and db.get(WorkspaceMembership, (workspace.id, task.responsible_user_id)) is not None:
        return json_response(ResponseCode.CONFLICT, "Forced handoff is only available after the owner leaves the project")
    if task.plan_item_id and db.execute(select(KanbanTask.id).where(
        KanbanTask.plan_item_id == task.plan_item_id,
        KanbanTask.source_version == task.source_version,
        KanbanTask.responsible_user_id == target_id,
        KanbanTask.id != task.id,
    )).first():
        return json_response(ResponseCode.CONFLICT, "Member already has a task from this plan version")
    reason = body.reason.strip()
    if not reason:
        return json_response(ResponseCode.BAD_REQUEST, "A handoff reason is required")
    run_id, agent = _pause_execution(db, workspace, task, cancel_workflow=True)
    old_id = task.responsible_user_id
    task.transfer_reason = reason
    if body.force:
        task.responsible_user_id = target_id
        task.transfer_user_id = None
        task.status = "backlog"
        task.position = _next_position(db, workspace.id, "backlog")
        task.decline_reason = None
    else:
        task.transfer_user_id = target_id
    _log_activity(task, "transfer_forced" if body.force else "transfer_requested", actor,
                  from_user_id=old_id, to_user_id=target_id, reason=reason)
    from app.services.notify import notify
    notify(db, workspace.id, source=f"human:{actor.email}", title="Task handoff",
           message=f"{task.title}: {reason}", channel_name=task.channel_name,
           recipient_user_id=target_id, reason="approval")
    db.commit()
    _signal_stop(workspace, db, task, run_id, agent)
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/transfer-accept")
def accept_task_transfer(body: TaskActionRequest, task_id: str,
                         db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if task.transfer_user_id != actor.id:
        return json_response(ResponseCode.FORBIDDEN, "This handoff is not addressed to you")
    if db.get(WorkspaceMembership, (workspace.id, actor.id)) is None:
        return json_response(ResponseCode.FORBIDDEN, "Project membership required")
    if task.plan_item_id and db.execute(select(KanbanTask.id).where(
        KanbanTask.plan_item_id == task.plan_item_id,
        KanbanTask.source_version == task.source_version,
        KanbanTask.responsible_user_id == actor.id,
        KanbanTask.id != task.id,
    )).first():
        return json_response(ResponseCode.CONFLICT, "Member already has a task from this plan version")
    old_id = task.responsible_user_id
    task.responsible_user_id = actor.id
    task.transfer_user_id = None
    task.decline_reason = None
    task.status = "backlog"
    task.position = _next_position(db, workspace.id, "backlog")
    _log_activity(task, "transfer_accepted", actor, from_user_id=old_id)
    db.commit()
    return success_response(_serialize_task(task))


@router.post("/tasks/{task_id}/complete-step")
def complete_member_workflow_step(body: CompleteStepRequest, task_id: str,
                                  db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, task, actor, error = _member_task(db, body.network, task_id, authorization)
    if error:
        return error
    if not _owner(task, actor) or task.status != "in_progress" or task.transfer_user_id:
        return json_response(ResponseCode.FORBIDDEN, "Only the active task owner may complete this step")
    from app.services.workflow import get_active_run, run_advance
    run = get_active_run(db, workspace.id, task.channel_name)
    if run is None or task.execution_status not in {"running", "need_input"}:
        return json_response(ResponseCode.CONFLICT, "No active workflow step")
    step = next((s for s in (run.snapshot or {}).get("steps", []) if s.get("id") == run.current_step), None)
    if not step or (step.get("assignee") or {}).get("kind") != "human":
        return json_response(ResponseCode.CONFLICT, "Current workflow step is not a human step")
    human = (step["assignee"].get("human") or "").lower()
    if human not in {"", actor.id.lower(), actor.email.lower(), (actor.username or "").lower()}:
        return json_response(ResponseCode.FORBIDDEN, "Workflow step belongs to another member")
    content = body.content.strip()
    if not content:
        return json_response(ResponseCode.BAD_REQUEST, "Step result is required")
    metadata = {"task_workflow_step_complete": True, "task_run_id": task.active_run_id,
                "workflow_step": run.current_step}
    event = Event(type="workspace.message.posted", source=f"human:{actor.email}",
                  target=f"channel/{task.channel_name}",
                  payload={"content": content, "message_type": "chat"}, metadata=metadata)
    if _emit_event_blocking(event, workspace, db) is None:
        return json_response(ResponseCode.CONFLICT, "Unable to complete the step")
    event_data = {"source": f"human:{actor.email}", "target": f"channel/{task.channel_name}",
                  "payload": {"content": content, "message_type": "chat"}, "metadata": metadata}
    if not run_advance(db, workspace.id, event_data):
        db.rollback()
        return json_response(ResponseCode.CONFLICT, "Workflow did not accept this step result")
    db.commit()
    return success_response(_serialize_task(task))
