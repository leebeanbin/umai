"use client";

/**
 * WebSocket 클라이언트 훅
 *
 * useChatSocket(chatId)    — 채팅방 이벤트 수신 (messages_saved 등)
 * useTaskSocket()          — 태스크 완료 알림 수신 (task_done 만 필터링)
 * useWorkflowSocket()      — 워크플로우 이벤트 수신 (task:{user_id} 채널 전체 이벤트)
 *
 * 연결 URL: NEXT_PUBLIC_WS_URL env (없으면 ws://localhost:8000)
 * 인증:     ?token=<access_token> (HTTPS 환경에서만 안전)
 */

import { useEffect, useRef, useCallback } from "react";
import { getStoredToken, isAuthenticated } from "@/lib/api/backendClient";
import { API } from "@/lib/api/endpoints";
import {
  WS_MAX_RECONNECT_ATTEMPTS, WS_BACKOFF_BASE_MS, WS_BACKOFF_EXPONENT,
  WS_BACKOFF_JITTER_MS, WS_BACKOFF_MAX_MS, WS_PING_INTERVAL_MS,
} from "@/lib/constants";

const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8000`
    : "ws://localhost:8000");

type WsEvent = Record<string, unknown> & { type: string };

/** M8: 지수 백오프 + 지터 */
function backoffMs(attempt: number): number {
  return Math.min(
    WS_BACKOFF_BASE_MS * Math.pow(WS_BACKOFF_EXPONENT, attempt) + Math.random() * WS_BACKOFF_JITTER_MS,
    WS_BACKOFF_MAX_MS,
  );
}

// ── 채팅방 이벤트 ─────────────────────────────────────────────────────────────

export function useChatSocket(
  chatId: string | undefined,
  onEvent: (event: WsEvent) => void,
) {
  const wsRef       = useRef<WebSocket | null>(null);
  const onEventRef  = useRef(onEvent);
  const attemptRef  = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destroyedRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!chatId || !isAuthenticated()) return;

    destroyedRef.current = false;
    attemptRef.current = 0;

    function connect() {
      if (destroyedRef.current) return;

      // M9: 재연결 시 신선한 토큰 사용
      const token = getStoredToken() ?? "";
      const url   = `${WS_BASE}${API.WS.CHAT(chatId!, token)}`;
      const ws    = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          onEventRef.current(JSON.parse(e.data) as WsEvent);
        } catch { /* malformed JSON — ignore */ }
      };

      ws.onerror = () => { /* reconnect handled by onclose */ };

      ws.onclose = (e) => {
        wsRef.current = null;
        // 정상 종료(1000) 또는 인증 실패(4001/4003)는 재연결 안 함
        if (destroyedRef.current || e.code === 1000 || e.code === 4001 || e.code === 4003) return;
        // max retry 초과 시 포기
        if (attemptRef.current >= WS_MAX_RECONNECT_ATTEMPTS) return;
        // M8: 지수 백오프 재연결
        const delay = backoffMs(attemptRef.current++);
        timerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      destroyedRef.current = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [chatId]);
}

// ── 태스크 완료 알림 채널 ─────────────────────────────────────────────────────

export function useTaskSocket(
  onTaskDone: (taskId: string, taskName: string) => void,
) {
  const wsRef       = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onTaskDone);
  const connectRef  = useRef<(() => void) | null>(null);
  const attemptRef  = useRef(0);
  const destroyedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onTaskDone;
  }, [onTaskDone]);

  const connect = useCallback(() => {
    if (!isAuthenticated() || destroyedRef.current) return;

    // M9: 재연결 시 신선한 토큰 사용
    const token = getStoredToken() ?? "";
    const url   = `${WS_BASE}${API.WS.TASKS(token)}`;
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
    }, WS_PING_INTERVAL_MS);

    ws.onclose = (e) => {
      clearInterval(pingInterval);
      wsRef.current = null;
      if (destroyedRef.current || e.code === 1000 || e.code === 4001) return;
      if (attemptRef.current >= WS_MAX_RECONNECT_ATTEMPTS) return;
      // M8: 지수 백오프 재연결
      const delay = backoffMs(attemptRef.current++);
      setTimeout(() => connectRef.current?.(), delay);
    };

    ws.onopen = () => {
      // 연결 성공 시 재시도 카운터 초기화
      attemptRef.current = 0;
    };
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    destroyedRef.current = false;
    connect();
    return () => {
      destroyedRef.current = true;
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [connect]);
}

// ── 워크플로우 이벤트 채널 ─────────────────────────────────────────────────────
// task:{user_id} 채널에서 workflow_* 이벤트 타입도 수신해야 하므로
// useTaskSocket과 달리 모든 이벤트를 그대로 콜백에 전달함.

export function useWorkflowSocket(onEvent: (event: WsEvent) => void) {
  const wsRef        = useRef<WebSocket | null>(null);
  const onEventRef   = useRef(onEvent);
  const connectRef   = useRef<(() => void) | null>(null);
  const attemptRef   = useRef(0);
  const destroyedRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!isAuthenticated() || destroyedRef.current) return;

    const token = getStoredToken() ?? "";
    const url   = `${WS_BASE}${API.WS.TASKS(token)}`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data) as WsEvent);
      } catch { /* ignore */ }
    };

    // keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, WS_PING_INTERVAL_MS);

    ws.onclose = (e) => {
      clearInterval(pingInterval);
      wsRef.current = null;
      if (destroyedRef.current || e.code === 1000 || e.code === 4001) return;
      if (attemptRef.current >= WS_MAX_RECONNECT_ATTEMPTS) return;
      const delay = backoffMs(attemptRef.current++);
      setTimeout(() => connectRef.current?.(), delay);
    };

    ws.onopen = () => { attemptRef.current = 0; };
  }, []);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    destroyedRef.current = false;
    connect();
    return () => {
      destroyedRef.current = true;
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [connect]);
}
