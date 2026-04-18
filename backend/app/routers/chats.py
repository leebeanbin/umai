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
import asyncio
import logging
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    CHAT_LIST_DEFAULT_LIMIT, CHAT_LIST_MAX_LIMIT,
    CHAT_MSG_DEFAULT_LIMIT, CHAT_MSG_MAX_LIMIT,
    MSG_SAVE_MAX_RETRIES,
    RATE_CHAT_CREATE, RATE_CHAT_MESSAGE,
    RATE_CHAT_UPDATE, RATE_CHAT_DELETE, RATE_CHAT_TITLE, RATE_CHAT_MEMBER,
    RATE_CHAT_MSG_BATCH, RATE_CHAT_MSG_RATING,
)
from app.core.database import get_db, AsyncSessionLocal
from app.models.chat import Message
from app.models.user import User
from app.routers.deps import get_current_user
from app.core.config import settings
from app.core.errors import ErrCode
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from app.core.redis import publish_event
from app.core.redis_keys import key_chat_channel
from app.services.chat_service import ChatService
from app.services.title_service import (
    TitleService,
    OllamaConnectionError,
    OllamaTimeoutError,
    OllamaModelNotFoundError,
    TitleGenerationError,
)
from app.schemas.chat import (
    AddMessageRequest, ChatDetailOut, ChatMemberOut, ChatOut, MessageOut,
    CreateChatRequest, InviteMemberRequest, UpdateChatRequest,
    UpdateMemberRoleRequest, GenerateTitleRequest, GenerateTitleResponse,
    RateMessageRequest, RateMessageResponse,
    MessageBatchCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chats", tags=["chats"])


def get_chat_service(db: AsyncSession = Depends(get_db)) -> ChatService:
    return ChatService(db)


def get_title_service() -> TitleService:
    return TitleService(
        ollama_url=settings.OLLAMA_URL,
        model=settings.OLLAMA_TITLE_MODEL,
        timeout=settings.OLLAMA_TITLE_TIMEOUT,
    )


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
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(CHAT_LIST_DEFAULT_LIMIT, ge=1, le=CHAT_LIST_MAX_LIMIT),
    archived: bool = False,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    rows = await svc.list_chats(user.id, page, limit, archived)
    return [_chat_out(chat, role) for chat, role in rows]


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=ChatOut, status_code=201)
@limiter.limit(RATE_CHAT_CREATE)
async def create_chat(
    request: Request,
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
    msg_limit: int = Query(CHAT_MSG_DEFAULT_LIMIT, ge=1, le=CHAT_MSG_MAX_LIMIT),
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_with_messages_or_404(chat_id, msg_limit=msg_limit)
    member = await svc.require_member(chat, user, min_role="viewer")
    out = _chat_out(chat, member.role)
    return out.model_copy(update={
        "messages": [MessageOut.model_validate(m) for m in chat.messages]
    })


# ── 수정 (owner only) ─────────────────────────────────────────────────────────

@router.patch("/{chat_id}", response_model=ChatOut)
@limiter.limit(RATE_CHAT_UPDATE)
async def update_chat(
    request: Request,
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
@limiter.limit(RATE_CHAT_DELETE)
async def delete_chat(
    request: Request,
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    await svc.delete_chat(chat)


# ── 메시지 추가 (editor 이상) ─────────────────────────────────────────────────

@router.post("/{chat_id}/messages", status_code=201)
@limiter.limit(RATE_CHAT_MESSAGE)
async def add_message(
    request: Request,
    chat_id: uuid.UUID,
    body: AddMessageRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="editor")
    msg = await svc.add_message(chat_id, body.role, body.content, body.images, body.meta)
    return {"id": str(msg.id)}


# ── 메시지 배치 저장 — BackgroundTask write-back (editor 이상) ──────────────

async def _save_messages_bg(chat_id: uuid.UUID, rows: list[dict]) -> None:
    """채팅 메시지 배치를 DB에 저장하고 WS 이벤트를 발행한다 (BackgroundTask).
    C3: 최대 3회 지수 백오프 재시도 — 무음 소실 방지.
    """
    for attempt in range(MSG_SAVE_MAX_RETRIES):
        try:
            async with AsyncSessionLocal() as db:
                stmt = pg_insert(Message).values(rows).on_conflict_do_nothing(index_elements=["id"])
                await db.execute(stmt)
                await db.commit()
            await publish_event(key_chat_channel(str(chat_id)), {
                "type": "messages_saved",
                "ids": [str(r["id"]) for r in rows],
            })
            return  # 성공
        except Exception as exc:
            if attempt >= MSG_SAVE_MAX_RETRIES - 1:
                logger.error("_save_messages_bg failed after %d attempts (chat=%s): %s",
                             attempt + 1, chat_id, exc)
                return
            wait = 2 ** attempt  # 1s, 2s, ...
            logger.warning("_save_messages_bg attempt %d failed, retry in %ds: %s",
                           attempt + 1, wait, exc)
            await asyncio.sleep(wait)


@router.post("/{chat_id}/messages/batch", status_code=202)
@limiter.limit(RATE_CHAT_MSG_BATCH)
async def add_messages_batch(
    request: Request,
    chat_id: uuid.UUID,
    body: MessageBatchCreate,
    background_tasks: BackgroundTasks,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    """
    스트리밍 완료 후 user+assistant 쌍을 BackgroundTask로 비동기 저장.
    즉시 202 응답 반환, 저장 완료는 WS chat:{chat_id} 채널로 통보.
    """
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="editor")

    from datetime import datetime, timezone
    _now = datetime.now(timezone.utc)
    rows = [
        {
            "id": uuid.UUID(m.id) if m.id else uuid.uuid4(),
            "chat_id": chat_id,
            "role": m.role,
            "content": m.content,
            "images": m.images,
            "created_at": _now,  # 명시적 타임스탬프 — DB server_default 의존 제거
        }
        for m in body.messages
    ]
    background_tasks.add_task(_save_messages_bg, chat_id, rows)
    return {"queued": len(rows)}


# ── 메시지 평가 (viewer 이상 — 본인 채팅) ────────────────────────────────────

@router.patch("/{chat_id}/messages/{message_id}/rating", response_model=RateMessageResponse)
@limiter.limit(RATE_CHAT_MSG_RATING)
async def rate_message(
    request: Request,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    body: RateMessageRequest,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    """어시스턴트 메시지에 좋아요/싫어요 평가를 저장하거나 취소한다."""
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="viewer")
    msg = await svc.rate_message(message_id, body.rating)
    return RateMessageResponse(message_id=str(msg.id), rating=msg.rating)


# ── Markdown 내보내기 (viewer 이상) ───────────────────────────────────────────

@router.get("/{chat_id}/export", response_class=PlainTextResponse)
async def export_chat(
    chat_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_with_messages_or_404(chat_id, msg_limit=CHAT_MSG_MAX_LIMIT)
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
@limiter.limit(RATE_CHAT_MEMBER)
async def invite_member(
    request: Request,
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
@limiter.limit(RATE_CHAT_MEMBER)
async def update_member_role(
    request: Request,
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
@limiter.limit(RATE_CHAT_MEMBER)
async def remove_member(
    request: Request,
    chat_id: uuid.UUID,
    target_user_id: uuid.UUID,
    svc: ChatService = Depends(get_chat_service),
    user: User = Depends(get_current_user),
):
    chat = await svc.get_chat_or_404(chat_id)
    await svc.require_member(chat, user, min_role="owner")
    await svc.remove_member(chat_id, target_user_id)


# ── 제목 자동 생성 (editor 이상) ──────────────────────────────────────────────
#
# POST /chats/{id}/title
#   Ollama 경량 모델(OLLAMA_TITLE_MODEL)을 사용해 대화 내용에서 짧은 제목을 생성하고
#   채팅 제목을 즉시 업데이트한다.
#
# 에러 우선순위:
#   1. Ollama 연결 실패         → 503 OLLAMA_UNAVAILABLE
#   2. 응답 시간 초과            → 503 TITLE_GENERATION_FAILED (timeout 메시지)
#   3. 모델 없음 (404)          → 503 TITLE_GENERATION_FAILED (모델 이름 포함)
#   4. 그 외 Ollama HTTP 오류   → 503 TITLE_GENERATION_FAILED

@router.post("/{chat_id}/title", response_model=GenerateTitleResponse)
@limiter.limit(RATE_CHAT_TITLE)
async def generate_chat_title(
    request: Request,
    chat_id: uuid.UUID,
    body: GenerateTitleRequest,
    chat_svc: ChatService    = Depends(get_chat_service),
    title_svc: TitleService  = Depends(get_title_service),
    user: User               = Depends(get_current_user),
):
    """
    Ollama 경량 모델로 대화 첫 교환에서 제목을 생성하고 DB에 저장한다.
    생성된 제목은 응답으로도 반환되므로 프론트엔드가 별도 GET 없이 UI를 즉시 갱신할 수 있다.
    """
    chat = await chat_svc.get_chat_or_404(chat_id)
    await chat_svc.require_member(chat, user, min_role="editor")

    try:
        title = await title_svc.generate(body.user_content, body.assistant_content, body.language)
    except OllamaConnectionError:
        ErrCode.OLLAMA_UNAVAILABLE.raise_it()
    except (OllamaTimeoutError, OllamaModelNotFoundError, TitleGenerationError):
        ErrCode.TITLE_GENERATION_FAILED.raise_it()

    if title:
        await chat_svc.update_chat(chat, title=title)

    return GenerateTitleResponse(title=title)
