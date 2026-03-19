"""
폴더 라우터
- GET    /folders              내 폴더 목록
- POST   /folders              새 폴더 생성
- GET    /folders/{id}         폴더 상세 (포함된 채팅 목록)
- PATCH  /folders/{id}         폴더 수정 (이름, 설명, 시스템 프롬프트, 열림 상태)
- DELETE /folders/{id}         폴더 삭제
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.chat import Chat, Folder
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.chat import (
    ChatOut, CreateFolderRequest, FolderOut, UpdateFolderRequest,
)

router = APIRouter(prefix="/folders", tags=["folders"])


def _assert_owner(folder: Folder, user: User):
    if str(folder.user_id) != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your folder")


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[FolderOut])
async def list_folders(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Folder)
        .where(Folder.user_id == user.id)
        .order_by(Folder.created_at.asc())
    )
    return result.scalars().all()


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=FolderOut, status_code=201)
async def create_folder(
    body: CreateFolderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = Folder(
        user_id=user.id,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
    )
    db.add(folder)
    await db.flush()
    return folder


# ── 상세 (+ 소속 채팅 목록) ───────────────────────────────────────────────────

class FolderDetailOut(FolderOut):
    chats: list[ChatOut]


@router.get("/{folder_id}", response_model=FolderDetailOut)
async def get_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    _assert_owner(folder, user)

    chats_result = await db.execute(
        select(Chat)
        .where(Chat.folder_id == folder_id, Chat.is_archived == False, Chat.is_temporary == False)
        .order_by(Chat.updated_at.desc())
    )
    chats = chats_result.scalars().all()

    return {
        "id": folder.id,
        "name": folder.name,
        "description": folder.description,
        "system_prompt": folder.system_prompt,
        "is_open": folder.is_open,
        "created_at": folder.created_at,
        "chats": chats,
    }


# ── 수정 ─────────────────────────────────────────────────────────────────────

@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID,
    body: UpdateFolderRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    _assert_owner(folder, user)

    if body.name is not None:          folder.name = body.name
    if body.description is not None:   folder.description = body.description
    if body.system_prompt is not None: folder.system_prompt = body.system_prompt
    if body.is_open is not None:       folder.is_open = body.is_open

    return folder


# ── 삭제 ─────────────────────────────────────────────────────────────────────

@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    _assert_owner(folder, user)
    await db.delete(folder)
