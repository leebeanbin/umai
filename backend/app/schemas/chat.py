import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_serializer, field_validator


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    images: list[str] | None = None
    created_at: datetime

    @field_serializer("id")
    def _id(self, v: uuid.UUID) -> str:
        return str(v)


ChatMemberRole = Literal["owner", "editor", "viewer"]


class ChatMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    name: str
    email: str
    avatar_url: str | None
    role: ChatMemberRole
    created_at: datetime

    @field_serializer("user_id")
    def _user_id(self, v: uuid.UUID) -> str:
        return str(v)


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None = None
    is_pinned: bool
    is_archived: bool
    model: str | None
    created_at: datetime
    updated_at: datetime
    my_role: ChatMemberRole = "owner"

    @field_serializer("id", "folder_id")
    def _uuid(self, v: uuid.UUID | None) -> str | None:
        return str(v) if v else None


class ChatDetailOut(ChatOut):
    messages: list[MessageOut]


class CreateChatRequest(BaseModel):
    title: str = Field("New Chat", max_length=500)
    model: str | None = Field(None, max_length=200)
    folder_id: str | None = None
    is_temporary: bool = False


class UpdateChatRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    is_pinned: bool | None = None
    is_archived: bool | None = None
    folder_id: str | None = None


class AddMessageRequest(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., max_length=100_000)   # ~25k 토큰 상한
    images: list[str] | None = Field(None, max_length=10)
    meta: dict | None = None


class MessageCreate(BaseModel):
    """배치 저장용 단일 메시지 스키마."""
    id: str | None = None        # 프론트엔드 UUID 전달 시 idempotency 보장
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., max_length=100_000)
    images: list[str] | None = Field(None, max_length=10)


class MessageBatchCreate(BaseModel):
    """스트리밍 완료 후 user+assistant 쌍을 한 번에 저장."""
    messages: list[MessageCreate] = Field(..., min_length=1, max_length=20)


# ── Folder ────────────────────────────────────────────────────────────────────

class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    system_prompt: str | None = None
    is_open: bool
    created_at: datetime

    @field_serializer("id")
    def _id(self, v: uuid.UUID) -> str:
        return str(v)


class CreateFolderRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    system_prompt: str | None = Field(None, max_length=10_000)


class UpdateFolderRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    system_prompt: str | None = Field(None, max_length=10_000)
    is_open: bool | None = None


class FolderDetailOut(FolderOut):
    chats: list["ChatOut"] = []


# ── Title Generation ──────────────────────────────────────────────────────────

class GenerateTitleRequest(BaseModel):
    user_content:      str = Field(..., max_length=2000)
    assistant_content: str = Field(..., max_length=2000)
    language:          str = Field("en", pattern="^(en|ko|ja|zh|es|fr|de)$")


class GenerateTitleResponse(BaseModel):
    title: str


# ── Chat Member ────────────────────────────────────────────────────────────────

class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: ChatMemberRole = "editor"


class UpdateMemberRoleRequest(BaseModel):
    role: ChatMemberRole


# ── Message Rating ─────────────────────────────────────────────────────────────

class RateMessageRequest(BaseModel):
    rating: Literal["positive", "negative"] | None  # None = 평가 취소


class RateMessageResponse(BaseModel):
    message_id: str
    rating: str | None


# ── Admin Ratings ──────────────────────────────────────────────────────────────

class RatingEntryOut(BaseModel):
    message_id: str
    chat_id: str
    model: str | None
    rating: str
    message_preview: str
    user_email: str
    created_at: datetime
