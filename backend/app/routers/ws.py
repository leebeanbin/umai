"""
WebSocket 허브 — 채팅방 실시간 이벤트 + 태스크 완료 알림

엔드포인트:
  WS /ws/chat/{chat_id}
    채팅방 이벤트 수신 (messages_saved 등)
    → 연결 후 첫 메시지로 {"type":"auth","token":"<access_token>"} 전송 필요

  WS /ws/tasks
    사용자 전용 태스크 완료 알림 수신 (task_done)
    → 연결 후 첫 메시지로 {"type":"auth","token":"<access_token>"} 전송 필요

보안 레이어:
  1. UUID 형식 검증 (path traversal 방어)
  2. first-message 인증 (5초 타임아웃, 토큰 URL 미노출)
  3. Redis access:{token} 토큰 검증
  4. ChatMember DB 멤버십 확인 (chat 채널)
  5. 사용자당 동일 방 연결 수 제한 (MAX_CONNECTIONS_PER_USER_PER_ROOM = 5)
  6. WS 메시지 크기 제한 (10 KB)
  7. Redis 기반 rate limit (60 msg/min per user)
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.redis_keys import key_chat_channel
from app.core.constants import (
    WS_MAX_CONN_PER_USER_PER_ROOM, WS_MAX_CONN_TASK_CHANNEL,
    WS_MAX_MESSAGE_BYTES, WS_TOKEN_REVALIDATE_INTERVAL,
)
from app.core.database import AsyncSessionLocal
from app.core.redis import access_get, check_ws_rate_limit, get_pubsub_client
from app.services.chat_service import ChatService

_WS_AUTH_TIMEOUT = 5.0  # 초: first-message 인증 대기 타임아웃


async def _resolve_user_id(token: str) -> str | None:
    """토큰 → user_id 변환 (Redis access 키 검증)."""
    return await access_get(token)

router = APIRouter(tags=["websocket"])

MAX_CONNECTIONS_PER_USER_PER_ROOM = WS_MAX_CONN_PER_USER_PER_ROOM


class _ConnMeta:
    __slots__ = ("ws", "user_id")

    def __init__(self, ws: WebSocket, user_id: str) -> None:
        self.ws = ws
        self.user_id = user_id


class ConnectionManager:
    """채팅방별 WebSocket 연결 관리 (단일 프로세스)."""

    def __init__(self) -> None:
        self._rooms: dict[str, list[_ConnMeta]] = {}

    def _room(self, key: str) -> list[_ConnMeta]:
        return self._rooms.setdefault(key, [])

    def user_count(self, room: str, user_id: str) -> int:
        return sum(1 for m in self._room(room) if m.user_id == user_id)

    def add(self, room: str, meta: _ConnMeta) -> None:
        self._room(room).append(meta)

    def remove(self, room: str, meta: _ConnMeta) -> None:
        try:
            self._room(room).remove(meta)
        except ValueError:
            pass


manager = ConnectionManager()


async def _pubsub_forward(pubsub, websocket: WebSocket) -> None:
    """Redis pub/sub 메시지를 WebSocket 클라이언트로 중계."""
    try:
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                try:
                    await websocket.send_text(msg["data"])
                except Exception:
                    break
    except Exception:
        pass


async def _periodic_token_revalidate(
    websocket: WebSocket, token: str, interval_s: int = WS_TOKEN_REVALIDATE_INTERVAL
) -> None:
    """1분마다 토큰 재검증 — 만료/로그아웃 후 stale 연결 종료."""
    try:
        while True:
            await asyncio.sleep(interval_s)
            uid = await access_get(token)
            if not uid:
                await websocket.close(code=4001)
                return
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


# ── 채팅방 이벤트 채널 ────────────────────────────────────────────────────────

@router.websocket("/ws/chat/{chat_id}")
async def chat_ws(
    websocket: WebSocket,
    chat_id: str,
) -> None:
    # 1. UUID 형식 검증
    try:
        room_uuid = uuid.UUID(chat_id)
    except ValueError:
        await websocket.close(code=4003)
        return

    # 2. 연결 수락 후 first-message 인증 (토큰을 URL 쿼리 파라미터에서 제거)
    await websocket.accept()
    try:
        raw_auth = await asyncio.wait_for(websocket.receive_text(), timeout=_WS_AUTH_TIMEOUT)
        auth_msg = json.loads(raw_auth)
        if auth_msg.get("type") != "auth":
            await websocket.close(code=4001)
            return
        token = auth_msg.get("token", "")
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception):
        await websocket.close(code=4001)
        return

    # 3. 토큰 → user_id 검증
    user_id = await _resolve_user_id(token)
    if not user_id:
        await websocket.close(code=4001)
        return

    # 4. 채팅방 멤버십 확인 (단기 DB 세션)
    async with AsyncSessionLocal() as db:
        member = await ChatService(db).get_member(room_uuid, uuid.UUID(user_id))
    if not member:
        await websocket.close(code=4003)
        return

    # 5. 연결 수 제한
    if manager.user_count(chat_id, user_id) >= MAX_CONNECTIONS_PER_USER_PER_ROOM:
        await websocket.close(code=4029)
        return
    meta = _ConnMeta(websocket, user_id)
    manager.add(chat_id, meta)

    # 6. pub/sub 구독 (독립 연결)
    pubsub_client = await get_pubsub_client()
    pubsub = pubsub_client.pubsub()
    await pubsub.subscribe(key_chat_channel(chat_id))

    forward_task  = asyncio.create_task(_pubsub_forward(pubsub, websocket))
    reauth_task   = asyncio.create_task(_periodic_token_revalidate(websocket, token))

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > WS_MAX_MESSAGE_BYTES:
                await websocket.close(code=4008)
                break
            if not await check_ws_rate_limit(user_id):
                await websocket.close(code=4029)
                break
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        reauth_task.cancel()
        manager.remove(chat_id, meta)
        await pubsub.unsubscribe(key_chat_channel(chat_id))
        await pubsub_client.aclose()


# ── 사용자 전용 태스크 완료 알림 채널 ────────────────────────────────────────

@router.websocket("/ws/tasks")
async def tasks_ws(
    websocket: WebSocket,
) -> None:
    # 1. 연결 수락 후 first-message 인증 (토큰을 URL 쿼리 파라미터에서 제거)
    await websocket.accept()
    try:
        raw_auth = await asyncio.wait_for(websocket.receive_text(), timeout=_WS_AUTH_TIMEOUT)
        auth_msg = json.loads(raw_auth)
        if auth_msg.get("type") != "auth":
            await websocket.close(code=4001)
            return
        token = auth_msg.get("token", "")
    except (asyncio.TimeoutError, json.JSONDecodeError, Exception):
        await websocket.close(code=4001)
        return

    # 2. 토큰 → user_id 검증
    user_id = await _resolve_user_id(token)
    if not user_id:
        await websocket.close(code=4001)
        return

    # 3. 연결 수 제한 (태스크 채널은 사용자당 최대 WS_MAX_CONN_TASK_CHANNEL)
    if manager.user_count("__tasks__", user_id) >= WS_MAX_CONN_TASK_CHANNEL:
        await websocket.close(code=4029)
        return
    meta = _ConnMeta(websocket, user_id)
    manager.add("__tasks__", meta)

    pubsub_client = await get_pubsub_client()
    pubsub = pubsub_client.pubsub()
    # Security: subscribe only to the authenticated user's private channel.
    # publish_task_done() in tasks/_utils.py publishes to task:{owner_id}, so
    # this subscription is already scoped to the current user — no cross-user
    # event leakage is possible via this channel.
    await pubsub.subscribe(f"task:{user_id}")

    forward_task = asyncio.create_task(_pubsub_forward(pubsub, websocket))
    reauth_task  = asyncio.create_task(_periodic_token_revalidate(websocket, token))

    try:
        while True:
            await websocket.receive_text()  # keepalive ping
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        reauth_task.cancel()
        manager.remove("__tasks__", meta)
        await pubsub.unsubscribe(f"task:{user_id}")
        await pubsub_client.aclose()
