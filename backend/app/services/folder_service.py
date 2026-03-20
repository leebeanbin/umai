"""
폴더 서비스 — Folder CRUD 비즈니스 로직.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ErrCode
from app.models.chat import Chat, Folder
from app.models.user import User


class FolderService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_folders(self, user_id: uuid.UUID) -> list[Folder]:
        result = await self.db.execute(
            select(Folder)
            .where(Folder.user_id == user_id)
            .order_by(Folder.created_at.asc())
        )
        return list(result.scalars().all())

    async def create_folder(
        self,
        user_id: uuid.UUID,
        name: str,
        description: str | None,
        system_prompt: str | None,
    ) -> Folder:
        folder = Folder(
            user_id=user_id,
            name=name,
            description=description,
            system_prompt=system_prompt,
        )
        self.db.add(folder)
        await self.db.flush()
        return folder

    async def get_folder(self, folder_id: uuid.UUID, user: User) -> Folder:
        folder = (await self.db.execute(
            select(Folder).where(Folder.id == folder_id)
        )).scalar_one_or_none()
        if not folder:
            ErrCode.FOLDER_NOT_FOUND.raise_it()
        if folder.user_id != user.id:
            ErrCode.FORBIDDEN.raise_it()
        return folder

    async def get_folder_chats(self, folder_id: uuid.UUID) -> list[Chat]:
        result = await self.db.execute(
            select(Chat)
            .where(
                Chat.folder_id == folder_id,
                Chat.is_archived == False,
                Chat.is_temporary == False,
            )
            .order_by(Chat.updated_at.desc())
        )
        return list(result.scalars().all())

    async def update_folder(self, folder: Folder, **kwargs: Any) -> Folder:
        for key, val in kwargs.items():
            if val is not None:
                setattr(folder, key, val)
        await self.db.flush()
        return folder

    async def delete_folder(self, folder: Folder) -> None:
        await self.db.delete(folder)
