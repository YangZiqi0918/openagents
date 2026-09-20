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

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.access import resolve_current_user, resolve_user_role, verify_human_project_access
from app.config import config
from app.models import Channel, ChannelMember, CloudAgentConfig, KanbanTask, User, Workflow, Workspace, WorkspaceMember, WorkspaceMembership
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


class TaskCommentRequest(TaskActionRequest):
    content: str = ""
    fileIds: List[str] = Field(default_factory=list)


class ReviewTaskRequest(TaskActionRequest):
    submissionVersion: int = Field(ge=1)
    decision: str  # approve | request_changes
    note: str = ""


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
    return _file_attachments(db, workspace_id, task.file_ids)


def _file_attachments(db: Session, workspace_id: str, file_ids: Optional[list]) -> list:
    from app.models import FileRecord

    if not file_ids:
        return []
    rows = db.execute(
        select(FileRecord).where(
            FileRecord.workspace_id == workspace_id,
            FileRecord.id.in_(file_ids),
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
        for r in (by_id[i] for i in file_ids if i in by_id)
    ]


def _task_attachment_metadata(db: Session, workspace_id: str, file_ids: Optional[list]) -> list:
    """Return stable, camelCase file metadata for task detail/timeline APIs."""
    from app.models import FileRecord

    ordered_ids = [file_id for file_id in (file_ids or []) if isinstance(file_id, str)]
    if not ordered_ids:
        return []
    rows = db.execute(select(FileRecord).where(
        FileRecord.workspace_id == workspace_id,
        FileRecord.id.in_(ordered_ids),
        FileRecord.status == "active",
    )).scalars().all()
    by_id = {row.id: row for row in rows}
    return [{
        "id": row.id,
        "filename": row.filename,
        "contentType": row.content_type,
        "size": row.size,
    } for file_id in ordered_ids if (row := by_id.get(file_id)) is not None]


def _actor_data(actor: Optional[User] = None, source: Optional[str] = None) -> tuple[str, dict]:
    if actor is not None:
        return f"human:{actor.email}", {
            "type": "human", "id": actor.id,
            "name": actor.display_name or actor.username or actor.email,
        }
    source = source or "system:task"
    if source.startswith("human:"):
        identity = source.removeprefix("human:")
        return source, {"type": "human", "id": identity, "name": identity}
    if source.startswith("openagents:"):
        name = source.removeprefix("openagents:")
        return source, {"type": "agent", "id": name, "name": name}
    return source, {"type": "system", "id": source, "name": source.split(":", 1)[-1] or "System"}


def _to_millis(value=None) -> int:
    if value is None:
        value = datetime.now(timezone.utc)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            value = datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def _record_task_event(
    db: Session,
    workspace_id: str,
    task: KanbanTask,
    category: str,
    kind: str,
    *,
    actor: Optional[User] = None,
    source: Optional[str] = None,
    categories: Optional[list[str]] = None,
    content: Optional[str] = None,
    attachments: Optional[list] = None,
    changes: Optional[list] = None,
    from_value=None,
    to_value=None,
    at=None,
):
    """Append one task event in the same transaction as its state change."""
    from app.models import EventRecord

    source, actor_payload = _actor_data(actor, source)
    timestamp = _to_millis(at)
    record = EventRecord(
        id=str(uuid4()),
        network_id=str(workspace_id),
        type=f"workspace.task.{category}",
        source=source,
        target=f"task/{task.id}",
        payload={
            "taskId": task.id,
            "categories": categories or [category],
            "kind": kind,
            "actor": actor_payload,
            "content": content,
            "attachments": attachments or [],
            "changes": changes or [],
            "from": from_value,
            "to": to_value,
        },
        metadata_={"task_id": task.id},
        timestamp=timestamp,
        visibility="channel",
    )
    db.add(record)
    return record


def _iso_from_millis(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()


def _cursor_encode(timestamp: int, event_id: str) -> str:
    raw = json.dumps([timestamp, event_id], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _cursor_decode(value: str) -> Optional[tuple[int, str]]:
    try:
        padded = value + "=" * (-len(value) % 4)
        timestamp, event_id = json.loads(base64.urlsafe_b64decode(padded.encode()))
        if not isinstance(timestamp, int) or not isinstance(event_id, str):
            return None
        return timestamp, event_id
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError):
        return None


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


def _serialize_task(
    t: KanbanTask,
    run: Optional[dict] = None,
    last_message: Optional[str] = None,
    attachments: Optional[list] = None,
) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "status": t.status,
        "assignee": t.assignee,
        "workflow_id": t.workflow_id,
        "knowledge_ids": t.knowledge_ids or [],
        "file_ids": t.file_ids or [],
        "attachments": attachments or [],
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

    file_ids = list(dict.fromkeys(
        file_id for task in tasks_list for file_id in (task.file_ids or [])
    ))
    attachment_rows = _task_attachment_metadata(db, workspace_id, file_ids)
    attachments_by_id = {attachment["id"]: attachment for attachment in attachment_rows}

    return [
        _serialize_task(
            t,
            run=run_info(runs_by_channel.get(t.channel_name)) if t.channel_name else None,
            last_message=last_by_channel.get(t.channel_name) if t.channel_name else None,
            attachments=[attachments_by_id[file_id] for file_id in (t.file_ids or [])
                         if file_id in attachments_by_id],
        )
        for t in tasks_list
    ]


def _timeline_actor(source: str, payload: dict, users_by_email: dict, users_by_id: dict) -> dict:
    stored = payload.get("actor")
    if isinstance(stored, dict) and stored.get("type") in {"human", "agent", "system"}:
        return {
            "type": stored["type"],
            "id": stored.get("id"),
            "name": stored.get("name") or stored.get("id") or "System",
        }
    if source.startswith("human:"):
        identity = source.removeprefix("human:")
        user = users_by_email.get(identity.lower()) or users_by_id.get(identity)
        return {
            "type": "human",
            "id": user.id if user else identity,
            "name": ((user.display_name or user.username or user.email) if user else
                     payload.get("sender_display_name") or payload.get("sender_name") or identity),
        }
    if source.startswith("openagents:"):
        name = source.removeprefix("openagents:")
        return {"type": "agent", "id": name, "name": name}
    name = source.split(":", 1)[-1] if source else "System"
    return {"type": "system", "id": source or None, "name": name or "System"}


def _timeline_categories(kind: str) -> list[str]:
    if kind in {"configured", "requirements_published", "dispatched"}:
        return ["activity", "history"]
    if kind in {
        "accepted", "submitted", "execution_started", "execution_stopped",
        "transfer_requested", "transfer_forced", "transfer_accepted",
        "review_approved", "review_returned", "execution_status_changed",
    }:
        return ["activity", "transition"]
    return ["activity"]


def _legacy_actor(user_id: Optional[str], users_by_id: dict) -> dict:
    user = users_by_id.get(user_id)
    return {
        "type": "human",
        "id": user_id,
        "name": (user.display_name or user.username or user.email) if user else (user_id or "Unknown member"),
    }


def _timeline_users(db: Session, workspace_id: str) -> tuple[dict, dict]:
    users = db.execute(select(User).join(
        WorkspaceMembership, WorkspaceMembership.user_id == User.id,
    ).where(WorkspaceMembership.workspace_id == workspace_id)).scalars().all()
    return ({user.id: user for user in users},
            {user.email.lower(): user for user in users if user.email})


def _timeline_event_item(event, users_by_id: dict, users_by_email: dict) -> Optional[dict]:
    payload = event.payload or {}
    if event.type.startswith("workspace.task."):
        category = event.type.removeprefix("workspace.task.")
        if category not in {"activity", "transition", "history"}:
            return None
        categories = [value for value in (payload.get("categories") or [category])
                      if value in {"activity", "comments", "transition", "history"}]
        return {
            "id": event.id, "categories": categories or [category],
            "kind": payload.get("kind") or category,
            "actor": _timeline_actor(event.source or "", payload, users_by_email, users_by_id),
            "content": payload.get("content"), "attachments": payload.get("attachments") or [],
            "changes": payload.get("changes") or [], "from": payload.get("from"),
            "to": payload.get("to"), "createdAt": _iso_from_millis(event.timestamp),
            "_timestamp": event.timestamp,
        }
    if event.type != "workspace.message.posted":
        return None
    metadata = event.metadata_ or {}
    is_comment = metadata.get("task_comment") is True
    message_type = payload.get("message_type") or "chat"
    return {
        "id": event.id, "categories": ["comments"] if is_comment else ["activity"],
        "kind": "comment" if is_comment else (f"agent_{message_type}" if message_type != "chat" else "message"),
        "actor": _timeline_actor(event.source or "", payload, users_by_email, users_by_id),
        "content": payload.get("content"), "attachments": payload.get("attachments") or [],
        "changes": [], "from": None, "to": None,
        "createdAt": _iso_from_millis(event.timestamp), "_timestamp": event.timestamp,
    }


def _legacy_timeline_items(task: KanbanTask, users_by_id: dict) -> list[dict]:
    items: list[dict] = []
    base_timestamp = _to_millis(task.created_at)
    submissions = task.submission_history or []
    for index, submission in enumerate(submissions):
        submitted_at = submission.get("submitted_at")
        if not submission.get("event_id"):
            timestamp = _to_millis(submitted_at) if submitted_at else base_timestamp + index
            items.append({
                "id": f"legacy-submission:{task.id}:{index}",
                "categories": ["activity", "transition"],
                "kind": "submitted",
                "actor": _legacy_actor(submission.get("user_id"), users_by_id),
                "content": submission.get("summary"),
                "attachments": [{"id": file_id} for file_id in (submission.get("file_ids") or [])],
                "changes": [], "from": "in_progress", "to": "need_input",
                "createdAt": _iso_from_millis(timestamp), "_timestamp": timestamp,
            })
        decision = submission.get("review_decision")
        if decision in {"approved", "returned"} and not submission.get("review_event_id"):
            timestamp = _to_millis(submission.get("reviewed_at") or submitted_at) + 1
            items.append({
                "id": f"legacy-review:{task.id}:{index}",
                "categories": ["activity", "transition"],
                "kind": "review_approved" if decision == "approved" else "review_returned",
                "actor": _legacy_actor(submission.get("reviewed_by_user_id"), users_by_id),
                "content": submission.get("review_comment") or None,
                "attachments": [], "changes": [], "from": "need_input",
                "to": "done" if decision == "approved" else "in_progress",
                "createdAt": _iso_from_millis(timestamp), "_timestamp": timestamp,
            })

    submission_actions = {"submitted"} if submissions else set()
    if any(entry.get("review_decision") for entry in submissions):
        submission_actions.update({"review_approved", "review_returned"})
    for index, entry in enumerate(task.activity_history or []):
        kind = entry.get("action") or "activity"
        if entry.get("event_id") or kind in submission_actions:
            continue
        timestamp = _to_millis(entry.get("at")) if entry.get("at") else base_timestamp + index
        details = {key: value for key, value in entry.items()
                   if key not in {"action", "actor_user_id", "at", "event_id"}}
        items.append({
            "id": f"legacy-activity:{task.id}:{index}",
            "categories": _timeline_categories(kind),
            "kind": kind,
            "actor": _legacy_actor(entry.get("actor_user_id"), users_by_id),
            "content": details.get("reason") or details.get("comment"),
            "attachments": [],
            "changes": [{"field": key, "from": None, "to": value} for key, value in details.items()],
            "from": details.get("from") or details.get("from_user_id"),
            "to": details.get("to") or details.get("to_user_id"),
            "createdAt": _iso_from_millis(timestamp), "_timestamp": timestamp,
        })

    return items


def _hydrate_timeline_attachments(db: Session, workspace_id: str, items: list[dict]) -> None:
    from app.models import FileRecord

    file_ids = {
        attachment.get("id") or attachment.get("fileId") or attachment.get("file_id")
        for item in items for attachment in item["attachments"] if isinstance(attachment, dict)
    }
    file_ids.discard(None)
    files = {row.id: row for row in db.execute(select(FileRecord).where(
        FileRecord.workspace_id == workspace_id,
        FileRecord.id.in_(file_ids),
        FileRecord.status == "active",
    )).scalars()} if file_ids else {}
    for item in items:
        hydrated = []
        for attachment in item["attachments"]:
            if not isinstance(attachment, dict):
                continue
            file_id = attachment.get("id") or attachment.get("fileId") or attachment.get("file_id")
            file = files.get(file_id)
            if file is not None:
                hydrated.append({"id": file.id, "filename": file.filename,
                                 "contentType": file.content_type, "size": file.size})
            elif file_id:
                hydrated.append({
                    "id": file_id,
                    "filename": attachment.get("filename") or attachment.get("name") or file_id,
                    "contentType": attachment.get("contentType") or attachment.get("content_type"),
                    "size": attachment.get("size"),
                })
        item["attachments"] = hydrated


def _timeline_event_query(
    workspace_id: str,
    task: KanbanTask,
    category: str,
    actor_type: Optional[str],
    sort: str,
    cursor: Optional[tuple[int, str]],
    limit: int,
):
    """Build the bounded event-store query for one timeline page."""
    from app.models import EventRecord

    structured_types = {
        "activity": ("workspace.task.activity", "workspace.task.transition", "workspace.task.history"),
        "transition": ("workspace.task.transition",),
        "history": ("workspace.task.history",),
        "all": ("workspace.task.activity", "workspace.task.transition", "workspace.task.history"),
    }
    sources = []
    if category != "comments":
        sources.append(and_(
            EventRecord.target == f"task/{task.id}",
            EventRecord.type.in_(structured_types[category]),
        ))
    if task.channel_name and category in {"all", "activity", "comments"}:
        comment_flag = EventRecord.metadata_["task_comment"].as_boolean()
        message_filters = [
            EventRecord.target == f"channel/{task.channel_name}",
            EventRecord.type == "workspace.message.posted",
        ]
        if category == "comments":
            message_filters.append(comment_flag.is_(True))
        elif category == "activity":
            message_filters.append(comment_flag.is_not(True))
        sources.append(and_(*message_filters))

    query = select(EventRecord).where(
        EventRecord.network_id == workspace_id,
        or_(*sources) if sources else false(),
    )
    if actor_type == "human":
        query = query.where(EventRecord.source.like("human:%"))
    elif actor_type == "agent":
        query = query.where(EventRecord.source.like("openagents:%"))
    elif actor_type == "system":
        query = query.where(
            EventRecord.source.not_like("human:%"),
            EventRecord.source.not_like("openagents:%"),
        )
    if cursor:
        timestamp, event_id = cursor
        if sort == "desc":
            query = query.where(or_(
                EventRecord.timestamp < timestamp,
                and_(EventRecord.timestamp == timestamp, EventRecord.id < event_id),
            ))
        else:
            query = query.where(or_(
                EventRecord.timestamp > timestamp,
                and_(EventRecord.timestamp == timestamp, EventRecord.id > event_id),
            ))
    ordering = ((EventRecord.timestamp.desc(), EventRecord.id.desc()) if sort == "desc"
                else (EventRecord.timestamp.asc(), EventRecord.id.asc()))
    return query.order_by(*ordering).limit(limit + 1)


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
    if workspace.kind == "project" and not verify_human_project_access(
        db, workspace, authorization, "member"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Project member access required")
    task = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.id == task_id,
    )).scalar_one_or_none()
    if not task:
        return json_response(ResponseCode.NOT_FOUND, "Task not found")
    return success_response(_enrich(db, str(workspace.id), [task])[0])


def _detail_task(db: Session, network: str, task_id: str, authorization: Optional[str], *, lock: bool = False):
    workspace = _resolve_workspace(db, network)
    if workspace is None or workspace.kind != "project" or workspace.status == "deleted":
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Project not found")
    if not verify_human_project_access(db, workspace, authorization, "member"):
        return None, None, None, json_response(ResponseCode.FORBIDDEN, "Project member access required")
    actor = resolve_current_user(db, authorization)
    if actor is None:
        return None, None, None, json_response(ResponseCode.UNAUTHORIZED, "Identity required")
    query = select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id,
        KanbanTask.id == task_id,
        KanbanTask.plan_item_id.is_not(None),
        KanbanTask.responsible_user_id.is_not(None),
    )
    if lock:
        query = query.with_for_update()
    task = db.execute(query).scalar_one_or_none()
    if task is None:
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Task not found")
    return workspace, task, actor, None


@router.get("/tasks/{task_id}/timeline")
def get_task_timeline(
    task_id: str,
    network: str = Query(...),
    category: str = Query("all"),
    actorType: Optional[str] = Query(None),
    sort: str = Query("desc"),
    cursor: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    workspace, task, _, error = _detail_task(db, network, task_id, authorization)
    if error:
        return error
    category = category.lower()
    if category not in {"all", "activity", "comments", "transition", "history"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid timeline category")
    actor_type = actorType.lower() if actorType else None
    if actor_type not in {None, "human", "agent", "system"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid timeline actor type")
    if sort not in {"asc", "desc"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid timeline sort")
    decoded_cursor = _cursor_decode(cursor) if cursor else None
    if cursor and decoded_cursor is None:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid timeline cursor")

    workspace_id = str(workspace.id)
    users_by_id, users_by_email = _timeline_users(db, workspace_id)
    events = db.execute(_timeline_event_query(
        workspace_id, task, category, actor_type, sort, decoded_cursor, limit,
    )).scalars().all()
    items = [item for event in events
             if (item := _timeline_event_item(event, users_by_id, users_by_email)) is not None]
    legacy_items = _legacy_timeline_items(task, users_by_id)
    if category != "all":
        legacy_items = [item for item in legacy_items if category in item["categories"]]
    if actor_type:
        legacy_items = [item for item in legacy_items if item["actor"]["type"] == actor_type]
    reverse = sort == "desc"
    if decoded_cursor:
        if reverse:
            legacy_items = [item for item in legacy_items
                            if (item["_timestamp"], item["id"]) < decoded_cursor]
        else:
            legacy_items = [item for item in legacy_items
                            if (item["_timestamp"], item["id"]) > decoded_cursor]
    items.extend(legacy_items)
    items.sort(key=lambda item: (item["_timestamp"], item["id"]), reverse=reverse)
    page = items[:limit]
    next_cursor = (_cursor_encode(page[-1]["_timestamp"], page[-1]["id"])
                   if len(items) > limit and page else None)
    _hydrate_timeline_attachments(db, workspace_id, page)
    for item in page:
        item.pop("_timestamp", None)
    return success_response({"items": page, "nextCursor": next_cursor})


@router.post("/tasks/{task_id}/comments")
def create_task_comment(
    body: TaskCommentRequest,
    task_id: str,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    from app.models import EventRecord
    from app.services.notify import notify

    workspace, task, actor, error = _detail_task(db, body.network, task_id, authorization, lock=True)
    if error:
        return error
    content = body.content.strip()
    file_ids = list(dict.fromkeys(file_id for file_id in body.fileIds if isinstance(file_id, str) and file_id))
    if not content and not file_ids:
        return json_response(ResponseCode.BAD_REQUEST, "A comment or attachment is required")
    if len(file_ids) != len(body.fileIds) or set(file_ids) != set(_clean_file_ids(db, workspace.id, file_ids) or []):
        return json_response(ResponseCode.BAD_REQUEST, "Attachment does not belong to this project")
    attachments = _file_attachments(db, str(workspace.id), file_ids)
    timestamp = _to_millis()
    event = EventRecord(
        id=str(uuid4()), network_id=str(workspace.id), type="workspace.message.posted",
        source=f"human:{actor.email}", target=f"channel/{task.channel_name}",
        payload={
            "content": content, "message_type": "chat", "attachments": attachments,
            "sender_type": "human", "sender_id": actor.id, "sender_email": actor.email,
            "sender_name": actor.display_name or actor.username or actor.email,
            "sender_display_name": actor.display_name or actor.username or actor.email,
        },
        metadata_={
            "task_comment": True, "target_agents": ["__no_response__"],
            "sender_email": actor.email, "sender_id": actor.id,
        },
        timestamp=timestamp, visibility="channel",
    )
    db.add(event)
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == workspace.id, Channel.name == task.channel_name,
    )).scalar_one_or_none()
    if channel is not None:
        channel.last_event_at = timestamp
    if actor.id != task.responsible_user_id:
        notify(
            db, str(workspace.id), source=f"human:{actor.email}", title="Task comment",
            message=f"New comment on “{task.title}” from {actor.display_name or actor.username or actor.email}.",
            channel_name=task.channel_name, recipient_user_id=task.responsible_user_id, reason="chat",
            link_url=(f"/projects/{workspace.id}?tab=plan&item={task.plan_item_id}"
                      f"&task={task.id}&view=comments"),
        )
    db.commit()
    try:
        from app.routers.events import _invalidate_poll_cache
        _invalidate_poll_cache(str(workspace.id), "workspace.message.posted")
    except Exception:
        logger.debug("Unable to invalidate event poll cache", exc_info=True)
    users_by_id, users_by_email = _timeline_users(db, str(workspace.id))
    item = _timeline_event_item(event, users_by_id, users_by_email)
    _hydrate_timeline_attachments(db, str(workspace.id), [item])
    item.pop("_timestamp", None)
    return success_response(item)


@router.post("/tasks/{task_id}/review")
def review_task_from_detail(
    body: ReviewTaskRequest,
    task_id: str,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    if body.decision not in {"approve", "request_changes"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid review decision")
    from app.routers.plan_items import _admin
    workspace, _, access_error = _admin(db, body.network, authorization)
    if access_error:
        return access_error
    task = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.id == task_id,
    )).scalar_one_or_none()
    if task is None:
        return json_response(ResponseCode.NOT_FOUND, "Review not found")
    from app.routers.task_reviews import ReviewDecision, decide_task_review
    result = decide_task_review(
        str(workspace.id),
        task_id,
        ReviewDecision(
            submission_version=body.submissionVersion,
            decision="approved" if body.decision == "approve" else "returned",
            comment=body.note,
        ),
        db,
        authorization,
    )
    if not isinstance(result, dict) or result.get("code") != ResponseCode.SUCCESS:
        return result
    db.refresh(task)
    return success_response(_enrich(db, str(task.workspace_id), [task])[0])


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

    previous_execution_status = task.execution_status
    task.channel_name = channel_name
    if task.responsible_user_id:
        task.active_run_id = str(uuid4())
        task.execution_status = "running"
        _record_task_event(
            db, str(workspace.id), task, "transition", "execution_started",
            source=human_source, categories=["activity", "transition"],
            from_value=previous_execution_status, to_value="running",
        )
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
    background_tasks: BackgroundTasks,
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
        if task.execution_status in {"running", "in_progress"}:
            return success_response(_serialize_task(task))
        if not task.workflow_id and (
            not task.assignee or (body.agent is not None and _bare_agent(body.agent) != task.assignee)
        ):
            return json_response(ResponseCode.CONFLICT, "Configure the task agent before running it")
    elif workspace.kind == "project" and authorization is not None and not verify_human_project_access(
        db, workspace, authorization, "admin"
    ):
        return json_response(ResponseCode.FORBIDDEN, "Only administrators may run unassigned project tasks")
    if not task.responsible_user_id and task.status == "in_progress" and task.channel_name:
        return success_response(_serialize_task(task))

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
    is_cloud_agent = (is_member.agent_type or "").startswith("cloud:")
    if is_cloud_agent and db.execute(select(CloudAgentConfig.id).where(
        CloudAgentConfig.workspace_id == workspace.id,
        CloudAgentConfig.agent_name == agent,
        CloudAgentConfig.status == "active",
    )).first() is None:
        return json_response(ResponseCode.CONFLICT, "Enable the project's cloud agent before running the task")

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
        if _emit_event_blocking(create_evt, workspace, db, token=x_workspace_token, commit=False) is None:
            db.rollback()
            return json_response(ResponseCode.FORBIDDEN, "Unable to create the task execution channel")
    else:
        # Reassignment — point the existing channel at the new agent.
        existing_channel.master_agent = agent
        _add_channel_agent(db, existing_channel, agent)
        db.flush()
        db.expire(existing_channel, ["participants"])

    # 2. Post the kickoff message (routes to the agent, starts the work).
    previous_execution_status = task.execution_status
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
        metadata={"target_agents": [agent], **({"task_run_id": task.active_run_id, "task_kickoff": True}
                                              if task.responsible_user_id else {})},
    )
    result = _emit_event_blocking(kickoff, workspace, db, token=x_workspace_token, commit=False)
    if result is None:
        db.rollback()
        return json_response(ResponseCode.FORBIDDEN, "Unable to start the task")

    # 3. Move the card to In Progress.
    task.assignee = agent
    task.channel_name = channel_name
    if not task.responsible_user_id:
        task.status = "in_progress"
        task.position = _next_position(db, str(workspace.id), "in_progress")
    else:
        _record_task_event(
            db, str(workspace.id), task, "transition", "execution_started",
            actor=actor, categories=["activity", "transition"],
            from_value=previous_execution_status, to_value="running",
        )

    db.commit()
    if is_cloud_agent:
        from app.services.cloud_agent import invoke_cloud_agents
        background_tasks.add_task(invoke_cloud_agents, str(workspace.id), {
            "id": result.id, "type": result.type, "source": result.source,
            "target": result.target, "payload": result.payload,
            "metadata": result.metadata, "timestamp": result.timestamp,
        })
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


def _log_activity(
    task: KanbanTask,
    action: str,
    actor: User,
    *,
    db: Optional[Session] = None,
    event_category: str = "activity",
    event_categories: Optional[list[str]] = None,
    content: Optional[str] = None,
    changes: Optional[list] = None,
    from_value=None,
    to_value=None,
    **fields,
):
    at = datetime.now(timezone.utc)
    record = None
    if db is not None:
        record = _record_task_event(
            db, str(task.workspace_id), task, event_category, action,
            actor=actor, categories=event_categories, content=content,
            changes=changes, from_value=from_value, to_value=to_value, at=at,
        )
    task.activity_history = [*(task.activity_history or []), {
        "action": action, "actor_user_id": actor.id, "at": at.isoformat(),
        **({"event_id": record.id} if record is not None else {}), **fields,
    }]
    return record


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
    if task.execution_status in {"running", "in_progress"}:
        return json_response(ResponseCode.CONFLICT, "Stop execution before changing its configuration")
    before = {
        "mode": "workflow" if task.workflow_id else "agent" if task.assignee else "manual",
        "agent": task.assignee, "workflowId": task.workflow_id,
        "knowledgeIds": task.knowledge_ids or [], "fileIds": task.file_ids or [],
    }
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
    after = {
        "mode": body.mode, "agent": task.assignee, "workflowId": task.workflow_id,
        "knowledgeIds": task.knowledge_ids or [], "fileIds": task.file_ids or [],
    }
    changes = [{"field": key, "from": before[key], "to": value}
               for key, value in after.items() if before[key] != value]
    _log_activity(
        task, "configured", actor, db=db, event_category="history",
        event_categories=["activity", "history"], changes=changes, mode=body.mode,
    )
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
    _log_activity(
        task, "accepted", actor, db=db, event_category="transition",
        event_categories=["activity", "transition"],
        from_value="backlog", to_value="in_progress",
    )
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
    _log_activity(task, "declined", actor, db=db, content=reason, reason=reason)
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
    submission = {
        "summary": summary, "file_ids": files, "user_id": actor.id,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    task.status = "need_input"
    task.position = _next_position(db, workspace.id, "need_input")
    event = _log_activity(
        task, "submitted", actor, db=db, event_category="transition",
        event_categories=["activity", "transition"], content=summary,
        from_value="in_progress", to_value="need_input",
    )
    submission["event_id"] = event.id
    task.submission_history = [*(task.submission_history or []), submission]
    from app.services.notify import notify
    for user_id in _task_admins(db, workspace.id):
        notify(db, workspace.id, source=f"human:{actor.email}", title="Task awaiting review",
               message=task.title, channel_name=task.channel_name,
               link_url=f"/projects/{workspace.id}?tab=review&task={task.id}",
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
    if task.status != "in_progress" or task.execution_status not in {"running", "in_progress", "need_input"}:
        return json_response(ResponseCode.CONFLICT, "Task is not in progress")
    previous_execution_status = task.execution_status
    run_id, agent = _pause_execution(db, workspace, task)
    if task.execution_status != previous_execution_status:
        _log_activity(
            task, "execution_stopped", actor, db=db, event_category="transition",
            event_categories=["activity", "transition"],
            from_value=previous_execution_status, to_value=task.execution_status,
        )
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
    _log_activity(
        task, "transfer_forced" if body.force else "transfer_requested", actor,
        db=db, event_category="transition", event_categories=["activity", "transition"],
        content=reason, from_value=old_id, to_value=target_id,
        from_user_id=old_id, to_user_id=target_id, reason=reason,
    )
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
    _log_activity(
        task, "transfer_accepted", actor, db=db, event_category="transition",
        event_categories=["activity", "transition"],
        from_value=old_id, to_value=actor.id, from_user_id=old_id,
    )
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
    if run is None or task.execution_status not in {"running", "in_progress", "need_input"}:
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
