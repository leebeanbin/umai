import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, field_serializer


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
    title: str = "New Chat"
    model: str | None = None
    folder_id: str | None = None
    is_temporary: bool = False


class UpdateChatRequest(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None
    is_archived: bool | None = None
    folder_id: str | None = None


class AddMessageRequest(BaseModel):
    role: str   # user | assistant
    content: str
    images: list[str] | None = None
    meta: dict | None = None


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
    name: str
    description: str | None = None
    system_prompt: str | None = None


class UpdateFolderRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    is_open: bool | None = None


class FolderDetailOut(FolderOut):
    chats: list["ChatOut"] = []


# ── Chat Member ────────────────────────────────────────────────────────────────

class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: ChatMemberRole = "editor"


class UpdateMemberRoleRequest(BaseModel):
    role: ChatMemberRole
