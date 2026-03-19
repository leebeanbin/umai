from datetime import datetime
from pydantic import BaseModel
import uuid


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    images: list[str] | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatOut(BaseModel):
    id: str
    title: str
    folder_id: str | None = None
    is_pinned: bool
    is_archived: bool
    model: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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
    id: uuid.UUID
    name: str
    description: str | None = None
    system_prompt: str | None = None
    is_open: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CreateFolderRequest(BaseModel):
    name: str
    description: str | None = None
    system_prompt: str | None = None


class UpdateFolderRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    is_open: bool | None = None
