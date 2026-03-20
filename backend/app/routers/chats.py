"""
채팅 라우터 — HTTP 관심사만 담당 (파싱, 직렬화, 상태코드).
비즈니스 로직은 ChatService에 위임.

- GET    /chats                       내가 오너 or 멤버인 채팅 목록
- POST   /chats                       새 채팅 생성 (생성자 = owner)
- GET    /chats/{id}                  채팅 상세 (멤버 이상 접근 가능)
- PATCH  /chats/{id}                  채팅 수정 (제목, 핀, 아카이브) — owner only
- DELETE /chats/{id}                  채팅 삭제 — owner only
- POST   /chats/{id}/messages         메시지 추가 — owner or editor
- GET    /chats/{id}/export           Markdown 내보내기 — 멤버 이상
- GET    /chats/{id}/members          멤버 목록 — 멤버 이상
- POST   /chats/{id}/members          멤버 초대 (이메일) — owner only
- PATCH  /chats/{id}/members/{uid}    멤버 역할 변경 — owner only
- DELETE /chats/{id}/members/{uid}    멤버 추방 — owner only
"""
import uuid
from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.routers.deps import get_current_user
from app.services.chat_service import ChatService
from app.schemas.chat import (
    AddMessageRequest, ChatDetailOut, ChatMemberOut, ChatOut, MessageOut,
    CreateChatRequest, InviteMemberRequest, UpdateChatRequest,
    UpdateMemberRoleRequest,
)

router = APIRouter(prefix="/chats", tags=["chats"])


def get_chat_service(db: AsyncSession = Depends(get_db)) -> ChatService:
    return ChatService(db)


def _chat_out(chat, my_role: str) -> ChatOut:
    return ChatOut.model_validate(chat).model_copy(update={"my_role": my_role})


def _member_out(member, user) -> ChatMemberOut:
    return ChatMemberOut.model_validate({
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "role": member.role,
        "created_at": member.created_at,
    })


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ChatOut])
async def list_chats(
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    archived: bool = False,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    rows = await svc.list_chats(user.id, page, limit, archived)
    return [_chat_out(chat, role) for chat, role in rows]


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=ChatOut, status_code=201)
async def create_chat(
    body: CreateChatRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    folder_id = uuid.UUID(body.folder_id) if body.folder_id else None
    chat, _ = await svc.create_chat(
        user_id=user.id,
        title=body.title,
        model=body.model,
        folder_id=folder_id,
        is_temporary=body.is_temporary,
    )
    return _chat_out(chat, "owner")


# ── 상세 ─────────────────────────────────────────────────────────────────────

@router.get("/{chat_id}", response_model=ChatDetailOut)
async def get_chat(
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_with_messages_or_404(chat_id)
    member = await svc.require_member(chat, user, min_role="viewer")
    out = _chat_out(chat, member.role)
    return out.model_copy(update={
        "messages": [MessageOut.model_validate(m) for m in chat.messages]
    })


# ── 수정 (owner only) ─────────────────────────────────────────────────────────

@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: uuid.UUID,
    body: UpdateChatRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")

    updates = {}
    if body.title is not None:      updates["title"] = body.title
    if body.is_pinned is not None:  updates["is_pinned"] = body.is_pinned
    if body.is_archived is not None: updates["is_archived"] = body.is_archived
    if body.folder_id is not None:
        updates["folder_id"] = uuid.UUID(body.folder_id) if body.folder_id else None

    chat = await svc.update_chat(chat, **updates)
    return _chat_out(chat, "owner")


# ── 삭제 (owner only) ─────────────────────────────────────────────────────────

@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    await svc.delete_chat(chat)


# ── 메시지 추가 (editor 이상) ─────────────────────────────────────────────────

@router.post("/{chat_id}/messages", status_code=201)
async def add_message(
    chat_id: uuid.UUID,
    body: AddMessageRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="editor")
    msg = await svc.add_message(chat_id, body.role, body.content, body.images, body.meta)
    return {"id": str(msg.id)}


# ── Markdown 내보내기 (viewer 이상) ───────────────────────────────────────────

@router.get("/{chat_id}/export", response_class=PlainTextResponse)
async def export_chat(
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_with_messages_or_404(chat_id)
    await svc.require_member(chat, user, min_role="viewer")

    lines = [f"# {chat.title}\n"]
    for m in chat.messages:
        label = "You" if m.role == "user" else "Umai"
        lines.append(f"**{label}**\n\n{m.content}\n")
    return "\n---\n\n".join(lines)


# ── 멤버 목록 (viewer 이상) ───────────────────────────────────────────────────

@router.get("/{chat_id}/members", response_model=list[ChatMemberOut])
async def list_members(
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="viewer")
    rows = await svc.list_members(chat_id)
    return [_member_out(m, u) for m, u in rows]


# ── 멤버 초대 (owner only) ────────────────────────────────────────────────────

@router.post("/{chat_id}/members", response_model=ChatMemberOut, status_code=201)
async def invite_member(
    chat_id: uuid.UUID,
    body: InviteMemberRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    member, target = await svc.invite_member(chat_id, body.email, user.id, body.role)
    return _member_out(member, target)


# ── 멤버 역할 변경 (owner only) ───────────────────────────────────────────────

@router.patch("/{chat_id}/members/{target_user_id}", response_model=ChatMemberOut)
async def update_member_role(
    chat_id: uuid.UUID,
    target_user_id: uuid.UUID,
    body: UpdateMemberRoleRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    member, target_user = await svc.update_member_role(chat_id, target_user_id, body.role)
    return _member_out(member, target_user)


# ── 멤버 추방 (owner only) ────────────────────────────────────────────────────

@router.delete("/{chat_id}/members/{target_user_id}", status_code=204)
async def remove_member(
    chat_id: uuid.UUID,
    target_user_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    await svc.remove_member(chat_id, target_user_id)
