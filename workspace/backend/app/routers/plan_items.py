"""Administrator-owned project plans and idempotent task dispatch."""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, verify_human_project_access
from app.database import get_db
from app.models import Channel, FileRecord, KanbanTask, PlanItem, User, Workspace, WorkspaceMembership
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace
from app.services.notify import notify

router = APIRouter(prefix="/v1/workspaces", tags=["Plans"])


class PlanFields(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    status: str = "todo"
    assignees: list[dict] = Field(default_factory=list)
    priority: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    startDate: Optional[str] = None
    dueDate: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    acceptanceCriteria: str = ""


class UpdatePlanRequest(PlanFields):
    version: int = Field(ge=1)


class DispatchRequest(BaseModel):
    userIds: list[str] = Field(min_length=1)
    version: int = Field(ge=1)


class PublishRequest(BaseModel):
    taskIds: list[str] = Field(min_length=1)
    version: int = Field(ge=1)


def _admin(db: Session, workspace_id: str, authorization: Optional[str]):
    workspace = _resolve_workspace(db, workspace_id)
    if workspace is None or workspace.kind != "project" or workspace.status == "deleted":
        return None, None, json_response(ResponseCode.NOT_FOUND, "Project not found")
    if not verify_human_project_access(db, workspace, authorization, "admin"):
        return None, None, json_response(ResponseCode.FORBIDDEN, "Administrator access required")
    user = resolve_current_user(db, authorization)
    if user is None:
        return None, None, json_response(ResponseCode.UNAUTHORIZED, "Identity required")
    return workspace, user, None


def _valid_date(value: Optional[str]) -> bool:
    if value is None:
        return True
    try:
        return date.fromisoformat(value).isoformat() == value
    except (TypeError, ValueError):
        return False


def _validate_fields(db: Session, workspace: Workspace, fields: PlanFields) -> Optional[str]:
    if not fields.title.strip():
        return "Title is required"
    if fields.status not in {"todo", "doing", "paused", "done"}:
        return "Invalid plan status"
    if fields.priority not in {None, "urgent", "high", "medium", "low"}:
        return "Invalid plan priority"
    if not _valid_date(fields.startDate) or not _valid_date(fields.dueDate) or (
        fields.startDate and fields.dueDate and fields.startDate > fields.dueDate
    ):
        return "Invalid plan dates"
    for assignee in fields.assignees:
        key = assignee.get("id", "")
        if not isinstance(key, str) or not key.startswith("human:"):
            return "Plans may assign only project members"
        try:
            user_id = str(UUID(key.removeprefix("human:")))
        except ValueError:
            return "Invalid member ID"
        member = db.get(WorkspaceMembership, (workspace.id, user_id))
        if member is None or member.role == "viewer":
            return "Assignee must be a project member"
    file_ids = []
    for attachment in fields.attachments:
        file_id = attachment.get("id")
        if not isinstance(file_id, str) or not file_id:
            return "Invalid attachment"
        file_ids.append(file_id)
    if file_ids:
        matched = set(db.execute(select(FileRecord.id).where(
            FileRecord.workspace_id == workspace.id,
            FileRecord.status == "active",
            FileRecord.id.in_(file_ids),
        )).scalars())
        if set(file_ids) != matched:
            return "Attachment does not belong to this project"
    return None


def _apply_fields(item: PlanItem, fields: PlanFields):
    item.title = fields.title.strip()
    item.description = fields.description.strip()
    item.status = fields.status
    item.assignees = fields.assignees
    item.priority = fields.priority
    item.tags = list(dict.fromkeys(tag.strip() for tag in fields.tags if tag.strip()))
    item.start_date = fields.startDate
    item.due_date = fields.dueDate
    item.attachments = fields.attachments
    item.acceptance_criteria = fields.acceptanceCriteria.strip()


def _task_summary(task: KanbanTask, users: dict) -> dict:
    person = users.get(task.responsible_user_id)
    return {
        "id": task.id,
        "responsibleUserId": task.responsible_user_id,
        "dispatchedUserId": task.dispatched_user_id,
        "responsibleName": (person.display_name or person.username or person.email) if person else None,
        "status": task.status,
        "sourceVersion": task.source_version,
        "submittedSummary": task.submitted_summary,
        "declineReason": task.decline_reason,
        "transferUserId": task.transfer_user_id,
    }


def _serialize(item: PlanItem, tasks: list[KanbanTask], users: dict) -> dict:
    if not tasks:
        status = item.status
    elif all(task.status == "done" for task in tasks):
        status = "done"
    elif any(task.status == "in_progress" for task in tasks):
        status = "doing"
    elif any(task.status == "need_input" for task in tasks):
        status = "paused"
    else:
        status = "todo"
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "status": status,
        "assignees": item.assignees or [],
        "priority": item.priority,
        "tags": item.tags or [],
        "startDate": item.start_date,
        "dueDate": item.due_date,
        "attachments": item.attachments or [],
        "acceptanceCriteria": item.acceptance_criteria,
        "version": item.version,
        "tasks": [_task_summary(task, users) for task in tasks],
        "createdAt": item.created_at.isoformat() if item.created_at else None,
        "updatedAt": item.updated_at.isoformat() if item.updated_at else None,
    }


def _items_with_tasks(db: Session, workspace_id: str):
    items = db.execute(select(PlanItem).where(PlanItem.workspace_id == workspace_id).order_by(PlanItem.created_at)).scalars().all()
    tasks = db.execute(select(KanbanTask).where(KanbanTask.workspace_id == workspace_id, KanbanTask.plan_item_id.is_not(None)).order_by(KanbanTask.created_at)).scalars().all()
    by_item = {item.id: [] for item in items}
    for task in tasks:
        by_item.setdefault(task.plan_item_id, []).append(task)
    user_ids = {task.responsible_user_id for task in tasks if task.responsible_user_id}
    users = {user.id: user for user in db.execute(select(User).where(User.id.in_(user_ids))).scalars()} if user_ids else {}
    return items, by_item, users


@router.get("/{workspace_id}/plan-items")
def list_plan_items(workspace_id: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    items, by_item, users = _items_with_tasks(db, workspace.id)
    return success_response({"items": [_serialize(item, by_item.get(item.id, []), users) for item in items]})


@router.post("/{workspace_id}/plan-items")
def create_plan_item(workspace_id: str, body: PlanFields, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    if error_text := _validate_fields(db, workspace, body):
        return json_response(ResponseCode.BAD_REQUEST, error_text)
    item = PlanItem(workspace_id=workspace.id)
    _apply_fields(item, body)
    db.add(item)
    db.commit()
    return success_response(_serialize(item, [], {}))


@router.patch("/{workspace_id}/plan-items/{item_id}")
def update_plan_item(workspace_id: str, body: UpdatePlanRequest, item_id: str = Path(...), db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    item = db.execute(select(PlanItem).where(PlanItem.id == item_id, PlanItem.workspace_id == workspace.id).with_for_update()).scalar_one_or_none()
    if item is None:
        return json_response(ResponseCode.NOT_FOUND, "Plan item not found")
    if item.version != body.version:
        return json_response(ResponseCode.CONFLICT, "Plan item changed; reload before saving")
    if error_text := _validate_fields(db, workspace, body):
        return json_response(ResponseCode.BAD_REQUEST, error_text)
    _apply_fields(item, body)
    item.version += 1
    db.commit()
    _, by_item, users = _items_with_tasks(db, workspace.id)
    return success_response(_serialize(item, by_item.get(item.id, []), users))


@router.delete("/{workspace_id}/plan-items/{item_id}")
def delete_plan_item(workspace_id: str, item_id: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, _, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    item = db.execute(select(PlanItem).where(PlanItem.id == item_id, PlanItem.workspace_id == workspace.id)).scalar_one_or_none()
    if item is None:
        return json_response(ResponseCode.NOT_FOUND, "Plan item not found")
    if db.execute(select(KanbanTask.id).where(KanbanTask.plan_item_id == item.id)).first():
        return json_response(ResponseCode.CONFLICT, "Dispatched plan items cannot be deleted")
    db.delete(item)
    db.commit()
    return success_response({"id": item_id, "deleted": True})


@router.post("/{workspace_id}/plan-items/{item_id}/dispatch")
def dispatch_plan_item(workspace_id: str, item_id: str, body: DispatchRequest, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, actor, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    item = db.execute(select(PlanItem).where(PlanItem.id == item_id, PlanItem.workspace_id == workspace.id).with_for_update()).scalar_one_or_none()
    if item is None:
        return json_response(ResponseCode.NOT_FOUND, "Plan item not found")
    if item.version != body.version:
        return json_response(ResponseCode.CONFLICT, "Plan item changed; reload before dispatching")
    try:
        recipients = list(dict.fromkeys(str(UUID(user_id)) for user_id in body.userIds))
    except ValueError:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid recipient user ID")
    members = {m.user_id: m for m in db.execute(select(WorkspaceMembership).where(
        WorkspaceMembership.workspace_id == workspace.id, WorkspaceMembership.user_id.in_(recipients)
    )).scalars()}
    if len(members) != len(recipients) or any(member.role == "viewer" for member in members.values()):
        return json_response(ResponseCode.BAD_REQUEST, "Recipients must be project members")
    existing = {task.dispatched_user_id: task for task in db.execute(select(KanbanTask).where(
        KanbanTask.plan_item_id == item.id, KanbanTask.source_version == item.version,
        KanbanTask.dispatched_user_id.in_(recipients),
    )).scalars()}
    prior = db.execute(select(KanbanTask.dispatched_user_id).where(
        KanbanTask.plan_item_id == item.id, KanbanTask.source_version != item.version,
        KanbanTask.dispatched_user_id.in_(recipients),
    )).first()
    if prior:
        return json_response(ResponseCode.CONFLICT, "Member already has a task from this plan; publish changes instead")
    current_owners = set(db.execute(select(KanbanTask.responsible_user_id).where(
        KanbanTask.plan_item_id == item.id,
        KanbanTask.responsible_user_id.in_([user_id for user_id in recipients if user_id not in existing]),
    )).scalars())
    if current_owners:
        return json_response(ResponseCode.CONFLICT, "Member already owns a task from this plan")
    from app.routers.tasks import _next_position, _serialize_task
    result = []
    for user_id in recipients:
        task = existing.get(user_id)
        if task is None:
            task = KanbanTask(
                workspace_id=workspace.id, plan_item_id=item.id, responsible_user_id=user_id,
                dispatched_user_id=user_id,
                source_version=item.version, title=item.title, description=item.description,
                status="backlog", priority=item.priority or "normal", position=_next_position(db, workspace.id, "backlog"),
                created_by=f"human:{actor.email}", execution_status="idle",
                channel_name=None, acceptance_criteria=item.acceptance_criteria,
                tags=list(item.tags or []), start_date=item.start_date, due_date=item.due_date,
                file_ids=[a["id"] for a in (item.attachments or [])], submission_history=[],
                activity_history=[],
            )
            db.add(task)
            db.flush()
            task.channel_name = f"task:{task.id}"
            db.add(Channel(workspace_id=workspace.id, name=task.channel_name, title=task.title,
                           created_by=f"human:{actor.email}"))
            notify(db, workspace.id, source=f"human:{actor.email}", title="New task assigned",
                   message=item.title, channel_name=task.channel_name,
                   recipient_user_id=user_id, reason="approval")
        result.append(_serialize_task(task))
    db.commit()
    return success_response({"tasks": result})


@router.post("/{workspace_id}/plan-items/{item_id}/publish")
def publish_plan_changes(workspace_id: str, item_id: str, body: PublishRequest, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    workspace, actor, error = _admin(db, workspace_id, authorization)
    if error:
        return error
    item = db.execute(select(PlanItem).where(PlanItem.id == item_id, PlanItem.workspace_id == workspace.id).with_for_update()).scalar_one_or_none()
    if item is None:
        return json_response(ResponseCode.NOT_FOUND, "Plan item not found")
    if item.version != body.version:
        return json_response(ResponseCode.CONFLICT, "Plan item changed; reload before publishing")
    task_ids = list(dict.fromkeys(body.taskIds))
    tasks = db.execute(select(KanbanTask).where(KanbanTask.workspace_id == workspace.id, KanbanTask.plan_item_id == item.id,
                                             KanbanTask.id.in_(task_ids)).with_for_update()).scalars().all()
    if len(tasks) != len(task_ids) or any(task.status not in {"backlog", "in_progress"} for task in tasks):
        return json_response(ResponseCode.CONFLICT, "Only unsubmitted tasks from this plan may receive changes")
    if (len({task.responsible_user_id for task in tasks}) != len(tasks)
            or len({task.dispatched_user_id for task in tasks}) != len(tasks)):
        return json_response(ResponseCode.CONFLICT, "Multiple tasks for one member cannot receive the same plan version")
    for task in tasks:
        conflicting = db.execute(select(KanbanTask.id).where(
            KanbanTask.plan_item_id == item.id, KanbanTask.dispatched_user_id == task.dispatched_user_id,
            KanbanTask.source_version == item.version, KanbanTask.id != task.id,
        )).first()
        if conflicting:
            return json_response(ResponseCode.CONFLICT, "Another task was already dispatched for this version")
    from app.routers.tasks import _serialize_task
    for task in tasks:
        task.title = item.title
        task.description = item.description
        task.priority = item.priority or "normal"
        task.tags = list(item.tags or [])
        task.start_date, task.due_date = item.start_date, item.due_date
        task.acceptance_criteria = item.acceptance_criteria
        task.file_ids = [a["id"] for a in (item.attachments or [])]
        task.source_version = item.version
        notify(db, workspace.id, source=f"human:{actor.email}", title="Task requirements updated",
               message=item.title, channel_name=task.channel_name,
               recipient_user_id=task.responsible_user_id, reason="approval")
    db.commit()
    return success_response({"tasks": [_serialize_task(task) for task in tasks]})
