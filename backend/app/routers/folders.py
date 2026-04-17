"""
폴더 라우터 — HTTP 관심사만 담당.
비즈니스 로직은 FolderService에 위임.

- GET    /folders              내 폴더 목록
- POST   /folders              새 폴더 생성
- GET    /folders/{id}         폴더 상세 (포함된 채팅 목록)
- PATCH  /folders/{id}         폴더 수정
- DELETE /folders/{id}         폴더 삭제
"""
import uuid
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RATE_FOLDER_WRITE
from app.core.database import get_db
from app.models.user import User
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from app.routers.deps import get_current_user
from app.services.folder_service import FolderService
from app.schemas.chat import ChatOut, CreateFolderRequest, FolderDetailOut, FolderOut, UpdateFolderRequest

router = APIRouter(prefix="/folders", tags=["folders"])


def get_folder_service(db: AsyncSession = Depends(get_db)) -> FolderService:
    return FolderService(db)


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[FolderOut])
async def list_folders(
    svc: FolderService = Depends(get_folder_service),
    user: User = Depends(get_current_user),
):
    return await svc.list_folders(user.id)


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=FolderOut, status_code=201)
@limiter.limit(RATE_FOLDER_WRITE)
async def create_folder(
    request: Request,
    body: CreateFolderRequest,
    svc: FolderService = Depends(get_folder_service),
    user: User = Depends(get_current_user),
):
    return await svc.create_folder(
        user_id=user.id,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
    )


# ── 상세 (+ 소속 채팅 목록) ───────────────────────────────────────────────────

@router.get("/{folder_id}", response_model=FolderDetailOut)
async def get_folder(
    folder_id: uuid.UUID,
    svc: FolderService = Depends(get_folder_service),
    user: User = Depends(get_current_user),
):
    folder = await svc.get_folder(folder_id, user)
    chats = await svc.get_folder_chats(folder_id)
    return FolderDetailOut.model_validate(folder).model_copy(update={
        "chats": [ChatOut.model_validate(c) for c in chats]
    })


# ── 수정 ─────────────────────────────────────────────────────────────────────

@router.patch("/{folder_id}", response_model=FolderOut)
@limiter.limit(RATE_FOLDER_WRITE)
async def update_folder(
    request: Request,
    folder_id: uuid.UUID,
    body: UpdateFolderRequest,
    svc: FolderService = Depends(get_folder_service),
    user: User = Depends(get_current_user),
):
    folder = await svc.get_folder(folder_id, user)
    return await svc.update_folder(
        folder,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
        is_open=body.is_open,
    )


# ── 삭제 ─────────────────────────────────────────────────────────────────────

@router.delete("/{folder_id}", status_code=204)
@limiter.limit(RATE_FOLDER_WRITE)
async def delete_folder(
    request: Request,
    folder_id: uuid.UUID,
    svc: FolderService = Depends(get_folder_service),
    user: User = Depends(get_current_user),
):
    folder = await svc.get_folder(folder_id, user)
    await svc.delete_folder(folder)
