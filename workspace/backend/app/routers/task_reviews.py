"""Administrator review of submissions from dispatched project tasks."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FileRecord, KanbanTask, PlanItem, User
from app.response import ResponseCode, json_response, success_response
from app.routers.plan_items import _admin
from app.routers.tasks import _log_activity, _next_position
from app.services.notify import REASON_APPROVAL, REASON_TASK_COMPLETED, notify

router = APIRouter(prefix="/v1/workspaces", tags=["Task reviews"])


class ReviewDecision(BaseModel):
    submission_version: int = Field(ge=1)
    decision: str
    comment: str = ""


def _latest(task: KanbanTask):
    history = task.submission_history or []
    return history[-1] if history else None


def _state(task: KanbanTask):
    submission = _latest(task)
    if not submission:
        return None
    if task.status == "need_input" and not task.transfer_user_id and not submission.get("review_decision"):
        return "pending"
    if submission.get("review_decision") in {"approved", "returned"}:
        return "processed"
    return None


def _reviews(db: Session, workspace_id: str, tasks: list[KanbanTask]):
    plan_ids = {task.plan_item_id for task in tasks if task.plan_item_id}
    user_ids = {task.responsible_user_id for task in tasks if task.responsible_user_id}
    user_ids.update(entry.get("reviewed_by_user_id") for task in tasks
                    for entry in (task.submission_history or []) if entry.get("reviewed_by_user_id"))
    file_ids = {file_id for task in tasks for file_id in (_latest(task) or {}).get("file_ids", [])}
    plans = {p.id: p for p in db.execute(select(PlanItem).where(
        PlanItem.workspace_id == workspace_id, PlanItem.id.in_(plan_ids),
    )).scalars()} if plan_ids else {}
    users = {u.id: u for u in db.execute(select(User).where(User.id.in_(user_ids))).scalars()} if user_ids else {}
    files = {f.id: f for f in db.execute(select(FileRecord).where(
        FileRecord.workspace_id == workspace_id, FileRecord.id.in_(file_ids), FileRecord.status == "active",
    )).scalars()} if file_ids else {}

    result = []
    for task in tasks:
        history = []
        for entry in (task.submission_history or []):
            reviewer = users.get(entry.get("reviewed_by_user_id"))
            history.append({**entry, "reviewer_name": (reviewer.display_name or reviewer.username or reviewer.email)
                            if reviewer else None})
        submission = history[-1] if history else None
        if not submission:
            continue
        owner = users.get(task.responsible_user_id)
        result.append({
            "task_id": task.id, "plan_item_id": task.plan_item_id,
            "plan_title": plans[task.plan_item_id].title if task.plan_item_id in plans else None,
            "title": task.title, "description": task.description,
            "acceptance_criteria": task.acceptance_criteria or "",
            "responsible_user_id": task.responsible_user_id,
            "responsible_name": (owner.display_name or owner.username or owner.email) if owner else None,
            "status": task.status, "review_state": _state(task),
            "channel_name": task.channel_name, "submission_version": len(task.submission_history or []),
            "submission": submission,
            "files": [{"id": f.id, "filename": f.filename, "size": f.size, "content_type": f.content_type}
                      for file_id in submission.get("file_ids", []) if (f := files.get(file_id))],
            "submission_history": history,
            "activity_history": task.activity_history or [],
        })
    return result


@router.get("/{workspace_id}/task-reviews")
def list_task_reviews(workspace_id: str, state: str = Query("pending"), db: Session = Depends(get_db),
                      authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    if state not in {"pending", "processed"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid review state")
    tasks = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.responsible_user_id.is_not(None),
    )).scalars().all()
    selected = [task for task in tasks if _state(task) == state]
    selected.sort(key=lambda task: (_latest(task).get("reviewed_at") or _latest(task).get("submitted_at") or ""), reverse=True)
    return success_response({"items": _reviews(db, workspace.id, selected)})


@router.get("/{workspace_id}/task-reviews/{task_id}")
def get_task_review(workspace_id: str, task_id: str, db: Session = Depends(get_db),
                    authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    task = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.id == task_id,
        KanbanTask.responsible_user_id.is_not(None),
    )).scalar_one_or_none()
    if task is None or not _state(task):
        return json_response(ResponseCode.NOT_FOUND, "Review not found")
    return success_response(_reviews(db, workspace.id, [task])[0])


@router.post("/{workspace_id}/task-reviews/{task_id}/decision")
def decide_task_review(workspace_id: str, task_id: str, body: ReviewDecision,
                       db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, actor, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    if body.decision not in {"approved", "returned"}:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid review decision")
    comment = body.comment.strip()
    if body.decision == "returned" and not comment:
        return json_response(ResponseCode.BAD_REQUEST, "A return reason is required")
    task = db.execute(select(KanbanTask).where(
        KanbanTask.workspace_id == workspace.id, KanbanTask.id == task_id,
        KanbanTask.responsible_user_id.is_not(None),
    ).with_for_update()).scalar_one_or_none()
    if task is None:
        return json_response(ResponseCode.NOT_FOUND, "Review not found")
    if (_state(task) != "pending" or len(task.submission_history or []) != body.submission_version):
        return json_response(ResponseCode.CONFLICT, "Submission changed; reload before reviewing")

    history = list(task.submission_history)
    history[-1] = {**history[-1], "review_decision": body.decision, "review_comment": comment,
                   "reviewed_by_user_id": actor.id, "reviewed_at": datetime.now(timezone.utc).isoformat()}
    task.submission_history = history
    task.status = "done" if body.decision == "approved" else "in_progress"
    task.position = _next_position(db, workspace.id, task.status)
    task.execution_status = "done" if body.decision == "approved" else "idle"
    task.active_run_id = None
    _log_activity(task, "review_approved" if body.decision == "approved" else "review_returned",
                  actor, submission_version=body.submission_version, comment=comment)
    notify(db, workspace.id, source=f"human:{actor.email}",
           title="Task approved" if body.decision == "approved" else "Task returned for changes",
           message=task.title if body.decision == "approved" else f"{task.title}: {comment}",
           channel_name=task.channel_name, recipient_user_id=task.responsible_user_id,
           reason=REASON_TASK_COMPLETED if body.decision == "approved" else REASON_APPROVAL)
    db.commit()
    return success_response(_reviews(db, workspace.id, [task])[0])
