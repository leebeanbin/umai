"""
채팅 라우터
- GET    /chats                  내 채팅 목록
- POST   /chats                  새 채팅 생성
- GET    /chats/{id}             채팅 상세 (메시지 포함)
- PATCH  /chats/{id}             채팅 수정 (제목, 핀, 아카이브)
- DELETE /chats/{id}             채팅 삭제
- POST   /chats/{id}/messages    메시지 추가 (저장용)
- GET    /chats/{id}/export      Markdown 내보내기
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.chat import Chat, Message
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.chat import (
    AddMessageRequest, ChatDetailOut, ChatOut,
    CreateChatRequest, UpdateChatRequest,
)

router = APIRouter(prefix="/chats", tags=["chats"])


def _assert_owner(chat: Chat, user: User):
    if str(chat.user_id) != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your chat")


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ChatOut])
async def list_chats(
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = (
        select(Chat)
        .where(Chat.user_id == user.id, Chat.is_archived == archived, Chat.is_temporary == False)
        .order_by(Chat.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    result = await db.execute(q)
    return result.scalars().all()


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=ChatOut, status_code=201)
async def create_chat(
    body: CreateChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat = Chat(
        user_id=user.id,
        title=body.title,
        model=body.model,
        folder_id=uuid.UUID(body.folder_id) if body.folder_id else None,
        is_temporary=body.is_temporary,
    )
    db.add(chat)
    await db.flush()
    return chat


# ── 상세 ─────────────────────────────────────────────────────────────────────

@router.get("/{chat_id}", response_model=ChatDetailOut)
async def get_chat(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    _assert_owner(chat, user)
    return chat


# ── 수정 ─────────────────────────────────────────────────────────────────────

@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: uuid.UUID,
    body: UpdateChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_owner(chat, user)

    if body.title is not None:        chat.title = body.title
    if body.is_pinned is not None:    chat.is_pinned = body.is_pinned
    if body.is_archived is not None:  chat.is_archived = body.is_archived
    if body.folder_id is not None:
        chat.folder_id = uuid.UUID(body.folder_id) if body.folder_id else None

    return chat


# ── 삭제 ─────────────────────────────────────────────────────────────────────

@router.delete("/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_owner(chat, user)
    await db.delete(chat)


# ── 메시지 추가 ───────────────────────────────────────────────────────────────

@router.post("/{chat_id}/messages", status_code=201)
async def add_message(
    chat_id: uuid.UUID,
    body: AddMessageRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_owner(chat, user)

    msg = Message(
        chat_id=chat_id,
        role=body.role,
        content=body.content,
        images=body.images,
        meta=body.meta,
    )
    db.add(msg)
    await db.flush()
    return {"id": str(msg.id)}


# ── Markdown 내보내기 ─────────────────────────────────────────────────────────

@router.get("/{chat_id}/export", response_class=PlainTextResponse)
async def export_chat(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_owner(chat, user)

    lines = [f"# {chat.title}\n"]
    for m in chat.messages:
        label = "You" if m.role == "user" else "Umai"
        lines.append(f"**{label}**\n\n{m.content}\n")
    return "\n---\n\n".join(lines)
