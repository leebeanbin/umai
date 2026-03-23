"use client";

/**
 * WebSocket 클라이언트 훅
 *
 * useChatSocket(chatId)   — 채팅방 이벤트 수신 (messages_saved 등)
 * useTaskSocket()         — 태스크 완료 알림 수신 (task_done, 폴링 대체)
 *
 * 연결 URL: NEXT_PUBLIC_WS_URL env (없으면 ws://localhost:8000)
 * 인증:     ?token=<access_token> (HTTPS 환경에서만 안전)
 */

import { useEffect, useRef, useCallback } from "react";
import { getStoredToken, isAuthenticated } from "@/lib/api/backendClient";

const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8000`
    : "ws://localhost:8000");

type WsEvent = Record<string, unknown> & { type: string };

// ── 채팅방 이벤트 ─────────────────────────────────────────────────────────────

export function useChatSocket(
  chatId: string | undefined,
  onEvent: (event: WsEvent) => void,
) {
  const wsRef     = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!chatId || !isAuthenticated()) return;

    const token = getStoredToken();
    const url   = `${WS_BASE}/ws/chat/${chatId}?token=${encodeURIComponent(token)}`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data) as WsEvent);
      } catch { /* malformed JSON — ignore */ }
    };

    ws.onerror = () => { /* reconnect handled by onclose */ };

    ws.onclose = (e) => {
      // 정상 종료(1000) 또는 인증 실패(4001/4003)는 재연결 안 함
      if (e.code === 1000 || e.code === 4001 || e.code === 4003) return;
      // 그 외에는 3초 후 재연결
      const timer = setTimeout(() => {
        if (wsRef.current === ws) wsRef.current = null;
      }, 3000);
      return () => clearTimeout(timer);
    };

    return () => {
      ws.close(1000);
      wsRef.current = null;
    };
  }, [chatId]);
}

// ── 태스크 완료 알림 채널 ─────────────────────────────────────────────────────

export function useTaskSocket(
  onTaskDone: (taskId: string, taskName: string) => void,
) {
  const wsRef      = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onTaskDone);
  callbackRef.current = onTaskDone;

  const connect = useCallback(() => {
    if (!isAuthenticated()) return;

    const token = getStoredToken();
    const url   = `${WS_BASE}/ws/tasks?token=${encodeURIComponent(token)}`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent;
        if (event.type === "task_done") {
          callbackRef.current(event.task_id as string, event.task as string);
        }
      } catch { /* ignore */ }
    };

    // keepalive ping 30초마다
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 30_000);

    ws.onclose = (e) => {
      clearInterval(pingInterval);
      if (e.code !== 1000 && e.code !== 4001) {
        // 3초 후 재연결
        setTimeout(connect, 3000);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [connect]);
}
