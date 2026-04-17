# 프론트엔드 아키텍처 (Next.js 15 App Router)

## 개요

```
frontend/src/
├── app/                    Next.js App Router (서버 컴포넌트 기반)
│   ├── api/                Route Handlers (서버 사이드 프록시)
│   │   ├── chat/route.ts   LLM 스트리밍 프록시
│   │   ├── ocr/route.ts    Ollama OCR
│   │   ├── websearch/      Tavily 검색
│   │   └── v1/[...path]/   FastAPI 프록시 (인증 포함)
│   ├── chat/               채팅 페이지
│   ├── workflow/           워크플로우 에디터
│   ├── workspace/          지식베이스, 모델, 파인튜닝
│   └── admin/              관리자 대시보드
├── components/             재사용 UI 컴포넌트
├── lib/
│   ├── api/
│   │   ├── backendClient.ts   apiFetch, 자동 토큰 갱신
│   │   └── endpoints.ts       API URL 상수
│   ├── hooks/
│   │   ├── useChat.ts         채팅 로직 (RAG, OCR, 스트리밍)
│   │   └── useWebSocket.ts    WS 연결 관리
│   ├── store.ts               세션(채팅 목록) localStorage
│   └── appStore.ts            전역 상태 (모델, 설정)
```

---

## API 호출 레이어: `apiFetch`

```typescript
// frontend/src/lib/api/backendClient.ts:93

export async function apiFetch<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
): Promise<T> {
    const token = _accessToken || (IS_DEV ? "dev" : "");
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        credentials: "include",    // HttpOnly refresh 쿠키 자동 포함
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init.headers ?? {}),
        },
    });

    // 401 → 자동 토큰 갱신 후 1회 재시도
    if (res.status === 401 && retry) {
        if (!refreshPromise) {
            refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
        }
        const refreshed = await refreshPromise;
        if (refreshed) return apiFetch<T>(path, init, false);
        clearTokens();
        window.dispatchEvent(new Event("umai:logout"));
        throw new Error("Session expired");
    }

    if (!res.ok) {
        throw new Error(`API error ${res.status}`);
    }
    return res.json() as Promise<T>;
}
```

**동시 401 처리 (Request Deduplication):**

```typescript
let refreshPromise: Promise<boolean> | null = null;

if (!refreshPromise) {
    // 첫 번째 401만 실제 refresh 요청을 보냄
    refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
}
// 나머지 동시 요청들은 같은 Promise를 기다림
const refreshed = await refreshPromise;
```

여러 API 요청이 동시에 401을 받으면, 모두 독립적으로 refresh를 시도하면 오류가 납니다.
(refresh token은 rotation 방식이므로 두 번째 refresh 요청에서 이미 무효화된 토큰을 사용)

`refreshPromise` 변수로 진행 중인 refresh 요청을 추적합니다.
동시 401이 와도 하나의 refresh 요청만 실행하고 나머지는 결과를 공유합니다.

---

## SSR 하이드레이션 패턴

Next.js App Router에서 서버는 localStorage에 접근할 수 없습니다.
`localStorage`의 데이터를 초기 상태로 쓰면 서버 렌더링 결과와 클라이언트가 달라
hydration mismatch 에러가 발생합니다.

```typescript
// 잘못된 패턴 — SSR과 CSR 불일치 발생
const [sessions, setSessions] = useState(
    JSON.parse(localStorage.getItem("sessions") || "[]")  // SSR에서 에러
);

// 올바른 패턴
const [sessions, setSessions] = useState<Session[]>([]);  // 서버: 빈 배열

useEffect(() => {
    const stored = localStorage.getItem("umai_sessions");
    if (stored) setSessions(JSON.parse(stored)); // eslint-disable-line react-hooks/set-state-in-effect
}, []);
```

`useEffect`는 클라이언트에서만 실행되므로 hydration 이후에 localStorage 값을 로드합니다.

---

## WebSocket 훅

```typescript
// frontend/src/lib/hooks/useWebSocket.ts

export function useChatSocket(chatId: string | undefined, onMessage: (e: MessageEvent) => void) {
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!chatId) return;

        const ws = new WebSocket(`${WS_BASE}/ws/chat/${chatId}`);

        ws.onopen = () => {
            // First-message 인증
            ws.send(JSON.stringify({ type: "auth", token: getStoredToken() }));
        };

        ws.onmessage = onMessage;

        ws.onclose = (e) => {
            // 4001 (인증 실패)은 재연결 시도 없음
            if (e.code !== 4001) {
                setTimeout(() => reconnect(), 3000);
            }
        };

        wsRef.current = ws;
        return () => ws.close();
    }, [chatId]);
}
```

재연결 로직: 비정상 종료(예: 네트워크 끊김) 시 3초 후 재연결합니다.
인증 실패(4001)는 토큰 문제이므로 재연결해도 의미가 없어 시도하지 않습니다.

---

## 스트리밍 채팅 구현

```typescript
// frontend/src/lib/hooks/useChat.ts

const res = await fetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages: apiMsgs, model, provider }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let fullText = "";

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    // SSE 파싱: "data: {...}\n\n"
    for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (data.choices?.[0]?.delta?.content) {
                fullText += data.choices[0].delta.content;
                // 실시간 UI 업데이트
                updateMessage(asstId, { content: fullText, streaming: true });
            }
        }
    }
}
```

`ReadableStream`을 청크 단위로 읽으며 SSE(Server-Sent Events) 형식을 파싱합니다.
각 토큰이 도착할 때마다 UI를 업데이트해 타이핑 효과를 만듭니다.

---

## Optimistic Update 패턴

UI를 즉시 업데이트하고, 실패 시 이전 상태로 롤백합니다:

```typescript
// frontend/src/components/chat/MessageList.tsx — 메시지 평가

const handleRate = async (newRating: "up" | "down" | null) => {
    const prev = rating;                    // 현재 상태 저장
    const next = rating === newRating ? null : newRating;
    setRating(next);                        // 낙관적 업데이트 (즉시 반영)

    if (chatId) {
        apiRateMessage(chatId, message.id, next)
            .catch(() => { setRating(prev); });  // 실패 시 롤백
    }
};
```

서버 응답을 기다리면 UI가 버벅입니다.
낙관적 업데이트로 즉시 반응하고, 실패 시 롤백합니다.

---

## 상태 관리 전략

Umai는 별도의 전역 상태 라이브러리(Redux, Zustand)를 사용하지 않습니다.

| 상태 종류 | 저장 위치 | 이유 |
|---|---|---|
| 채팅 메시지 | `useState` + `localStorage` | 컴포넌트 스코프, 오프라인 접근 |
| 세션 목록 | `localStorage` + React 동기화 | 탭 간 공유, 서버 재시작 후 유지 |
| 전역 설정(모델 등) | `appStore.ts` + `localStorage` | 앱 전체에서 접근 |
| 서버 데이터 | 각 페이지 `useState` | 간단한 fetch-on-mount |

서버 상태(React Query, SWR 등)도 사용하지 않습니다.
복잡도를 최소화하기 위해 단순한 fetch-on-mount 패턴을 사용합니다.

---

## Next.js Route Handler를 프록시로 사용하는 이유

```typescript
// frontend/src/app/api/v1/[...path]/route.ts

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
    const path = params.path.join("/");
    const token = extractBearerToken(req);

    const upstream = await fetch(`${INTERNAL_API_URL}/api/v1/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return new Response(upstream.body, { status: upstream.status });
}
```

**왜 프록시를 통하나?**

1. **CORS 우회**: 브라우저에서 직접 `api.umai.ai`를 호출하면 CORS 설정이 필요.
   Next.js 서버를 통하면 서버-서버 통신이므로 CORS 불필요.

2. **API 키 보호**: 브라우저 → Next.js → FastAPI 경로에서 API 키가 클라이언트에 노출되지 않음.

3. **단일 도메인**: 프론트엔드와 API가 같은 도메인(`.umai.ai`)이므로 쿠키 공유가 쉬움.

---

## 에러 처리 UI 패턴

```typescript
// frontend/src/app/workflow/page.tsx

const [loadError, setLoadError] = useState<string | null>(null);

useEffect(() => {
    apiFetch<Workflow[]>("/api/v1/workflow/")
        .then(setWorkflows)
        .catch(() => setLoadError("워크플로우를 불러오지 못했습니다."));
}, []);

// JSX
{loadError && (
    <div className="bg-red-50 text-red-700 p-4 rounded-lg">
        {loadError}
    </div>
)}
```

`.catch(() => {})` (silent failure) 대신 사용자에게 에러를 표시합니다.
에러 메시지는 재시도를 안내하는 방식으로 작성합니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `frontend/src/lib/api/backendClient.ts` | apiFetch, 토큰 관리 |
| `frontend/src/lib/hooks/useChat.ts` | 채팅 로직, 스트리밍, RAG |
| `frontend/src/lib/hooks/useWebSocket.ts` | WS 연결, 재연결 |
| `frontend/src/lib/store.ts` | 세션 localStorage |
| `frontend/src/lib/appStore.ts` | 전역 설정 |
| `frontend/src/app/api/chat/route.ts` | LLM 스트리밍 프록시 |
