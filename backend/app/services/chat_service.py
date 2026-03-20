"""
채팅 서비스 — Chat / Message / ChatMember 비즈니스 로직.

라우터는 HTTP 관심사(파싱, 직렬화, 상태코드)만 담당하고,
모든 DB 쿼리 및 권한 판단은 이 서비스에 위임한다.

역할 계층: viewer(0) < editor(1) < owner(2)
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ErrCode
from app.models.chat import Chat, ChatMember, Message
from app.models.user import User

# ── 역할 계층 (Open/Closed: 새 역할 추가 시 여기만 수정) ──────────────────────

ROLE_RANK: dict[str, int] = {"viewer": 0, "editor": 1, "owner": 2}


class ChatService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── 멤버 조회 / 권한 확인 ─────────────────────────────────────────────────

    async def get_member(
        self, chat_id: uuid.UUID, user_id: uuid.UUID
    ) -> ChatMember | None:
        result = await self.db.execute(
            select(ChatMember).where(
                ChatMember.chat_id == chat_id,
                ChatMember.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def require_member(
        self, chat: Chat, user: User, min_role: str = "viewer"
    ) -> ChatMember:
        member = await self.get_member(chat.id, user.id)
        if not member:
            ErrCode.FORBIDDEN.raise_it()
        if ROLE_RANK[member.role] < ROLE_RANK[min_role]:
            ErrCode.INSUFFICIENT_ROLE.raise_it(
                f"이 작업은 {min_role} 이상의 권한이 필요합니다."
            )
        return member

    # ── 채팅 CRUD ─────────────────────────────────────────────────────────────

    async def list_chats(
        self,
        user_id: uuid.UUID,
        page: int,
        limit: int,
        archived: bool,
    ) -> list[tuple[Chat, str]]:
        """내가 멤버인 채팅 목록 (페이지네이션)."""
        member_subq = (
            select(ChatMember.chat_id, ChatMember.role)
            .where(ChatMember.user_id == user_id)
            .subquery()
        )
        q = (
            select(Chat, member_subq.c.role)
            .join(member_subq, Chat.id == member_subq.c.chat_id)
            .where(Chat.is_archived == archived, Chat.is_temporary == False)
            .order_by(Chat.updated_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        rows = (await self.db.execute(q)).all()
        return [(chat, role) for chat, role in rows]

    async def create_chat(
        self,
        user_id: uuid.UUID,
        title: str,
        model: str | None,
        folder_id: uuid.UUID | None,
        is_temporary: bool,
    ) -> tuple[Chat, ChatMember]:
        """
        채팅 생성 + 오너 멤버 등록을 단일 트랜잭션으로 처리.
        두 INSERT가 하나의 flush 범위 안에 있어 원자성 보장.
        """
        chat = Chat(
            user_id=user_id,
            title=title,
            model=model,
            folder_id=folder_id,
            is_temporary=is_temporary,
        )
        self.db.add(chat)
        await self.db.flush()  # chat.id 확보

        member = ChatMember(chat_id=chat.id, user_id=user_id, role="owner")
        self.db.add(member)
        await self.db.flush()  # 같은 트랜잭션 — 롤백 시 둘 다 취소됨

        return chat, member

    async def get_chat(self, chat_id: uuid.UUID) -> Chat | None:
        result = await self.db.execute(select(Chat).where(Chat.id == chat_id))
        return result.scalar_one_or_none()

    async def get_chat_or_404(self, chat_id: uuid.UUID) -> Chat:
        """없으면 CHAT_NOT_FOUND(404) 즉시 raise."""
        chat = await self.get_chat(chat_id)
        if not chat:
            ErrCode.CHAT_NOT_FOUND.raise_it()
        return chat

    async def get_chat_with_messages(self, chat_id: uuid.UUID) -> Chat | None:
        result = await self.db.execute(
            select(Chat)
            .options(selectinload(Chat.messages))
            .where(Chat.id == chat_id)
        )
        return result.scalar_one_or_none()

    async def get_chat_with_messages_or_404(self, chat_id: uuid.UUID) -> Chat:
        chat = await self.get_chat_with_messages(chat_id)
        if not chat:
            ErrCode.CHAT_NOT_FOUND.raise_it()
        return chat

    async def update_chat(self, chat: Chat, **kwargs: Any) -> Chat:
        for key, val in kwargs.items():
            if val is not None:
                setattr(chat, key, val)
        await self.db.flush()
        return chat

    async def delete_chat(self, chat: Chat) -> None:
        await self.db.delete(chat)

    # ── 메시지 ────────────────────────────────────────────────────────────────

    async def add_message(
        self,
        chat_id: uuid.UUID,
        role: str,
        content: str,
        images: list | None,
        meta: dict | None,
    ) -> Message:
        msg = Message(
            chat_id=chat_id,
            role=role,
            content=content,
            images=images,
            meta=meta,
        )
        self.db.add(msg)
        await self.db.flush()
        return msg

    # ── 멤버 관리 ─────────────────────────────────────────────────────────────

    async def list_members(self, chat_id: uuid.UUID) -> list[tuple[ChatMember, User]]:
        rows = (await self.db.execute(
            select(ChatMember, User)
            .join(User, ChatMember.user_id == User.id)
            .where(ChatMember.chat_id == chat_id)
            .order_by(ChatMember.created_at)
        )).all()
        return [(m, u) for m, u in rows]

    async def invite_member(
        self,
        chat_id: uuid.UUID,
        target_email: str,
        inviter_id: uuid.UUID,
        role: str,
    ) -> tuple[ChatMember, User]:
        """
        이메일로 유저를 채팅에 초대한다.

        동시 요청 레이스 처리:
        - 중복 멤버 체크 후 flush 시 IntegrityError 발생 가능
        - UniqueConstraint(chat_id, user_id) 위반 → ALREADY_MEMBER(409)
        """
        target = (await self.db.execute(
            select(User).where(User.email == target_email)
        )).scalar_one_or_none()
        if not target:
            ErrCode.USER_NOT_FOUND.raise_it(f"'{target_email}' 유저를 찾을 수 없습니다.")
        if target.id == inviter_id:
            ErrCode.SELF_INVITE.raise_it()
        if await self.get_member(chat_id, target.id):
            ErrCode.ALREADY_MEMBER.raise_it()

        new_member = ChatMember(chat_id=chat_id, user_id=target.id, role=role)
        self.db.add(new_member)
        try:
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            ErrCode.ALREADY_MEMBER.raise_it()

        return new_member, target

    async def update_member_role(
        self,
        chat_id: uuid.UUID,
        target_user_id: uuid.UUID,
        new_role: str,
    ) -> tuple[ChatMember, User]:
        # Member + User를 JOIN으로 한 번에 조회 (별도 User 쿼리 제거)
        row = (await self.db.execute(
            select(ChatMember, User)
            .join(User, ChatMember.user_id == User.id)
            .where(ChatMember.chat_id == chat_id, ChatMember.user_id == target_user_id)
        )).one_or_none()
        if not row:
            ErrCode.MEMBER_NOT_FOUND.raise_it()

        target_member, target_user = row
        if target_member.role == "owner":
            ErrCode.CANNOT_CHANGE_OWNER.raise_it()
        if new_role == "owner":
            ErrCode.CANNOT_ASSIGN_OWNER.raise_it()

        target_member.role = new_role
        await self.db.flush()
        return target_member, target_user

    async def remove_member(
        self,
        chat_id: uuid.UUID,
        target_user_id: uuid.UUID,
    ) -> None:
        target_member = await self.get_member(chat_id, target_user_id)
        if not target_member:
            ErrCode.MEMBER_NOT_FOUND.raise_it()
        if target_member.role == "owner":
            ErrCode.CANNOT_KICK_OWNER.raise_it()
        await self.db.delete(target_member)
