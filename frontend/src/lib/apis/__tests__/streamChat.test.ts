// @vitest-environment node
/**
 * streamChat 클라이언트 SSE 파싱 + 파이프라인 정확도 테스트
 *
 * 커버 항목:
 *  SSE 파싱:
 *    - 정상 스트림 → onChunk 순서대로 호출, onDone 최종 호출
 *    - 여러 청크가 하나의 read()에 도착 → 모두 처리
 *    - 잘못된 JSON 청크 → 무시 (onError 없음)
 *    - 선행 개행(\\n) → 무시 (contentStarted 플래그)
 *    - [DONE] → 스트림 종료, onDone 호출
 *    - HTTP 오류 응답 → onError 호출, onDone 없음
 *    - AbortError → onDone 호출 (onError 아님)
 *    - 청크 경계에서 data: 줄 분할 → 버퍼링으로 올바르게 처리
 *    - delta.content가 null → 무시
 *
 *  Provider 라우팅:
 *    - gpt-4o → provider:openai
 *    - claude-* → provider:anthropic
 *    - gemini-* → provider:google
 *    - 모름 모델 → onError "Unknown model"
 *
 *  파라미터 전달:
 *    - temperature, maxTokens, topP가 요청 바디에 포함
 *    - sysPrompt가 비어있으면 undefined (전송 안 함)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChat } from "../chat";

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/appStore", () => ({
  loadSettings: () => ({
    selectedModel: "gpt-4o",
    systemPrompt: "",
    temperature: 0.8,
    maxTokens: 2048,
    inputLang: "auto",
    outputLang: "auto",
  }),
  loadModels: () => [],
}));

// ── SSE 스트림 헬퍼 ───────────────────────────────────────────────────────────

function makeSSEStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      for (const chunk of chunks) {
        ctrl.enqueue(encoder.encode(chunk));
      }
      ctrl.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("streamChat — SSE 파싱 정확도", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // requestAnimationFrame 없는 Node 환경 — batcher는 setTimeout fallback 사용
    vi.stubGlobal("document", { hidden: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("정상 스트림 → 청크 순서대로 수신, onDone 호출", async () => {
    fetchSpy.mockReturnValue(makeSSEStream([
      sseChunk("Hello"),
      sseChunk(" World"),
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    let done = false;

    const p = streamChat({
      messages:     [{ role: "user", content: "Hi" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => { done = true; },
      onError: ()  => {},
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;

    expect(chunks.join("")).toBe("Hello World");
    expect(done).toBe(true);
  });

  it("한 번의 read()에 여러 SSE 청크 도착 → 모두 처리", async () => {
    // 두 청크가 하나의 버퍼로 합쳐져 도착
    const combined = sseChunk("First") + sseChunk(" Second") + "data: [DONE]\n\n";
    fetchSpy.mockReturnValue(makeSSEStream([combined]));

    const chunks: string[] = [];
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => {},
      onError: ()  => {},
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(chunks.join("")).toBe("First Second");
  });

  it("잘못된 JSON 청크 → 무시, 이후 정상 청크 처리됨", async () => {
    fetchSpy.mockReturnValue(makeSSEStream([
      "data: {INVALID\n\n",
      sseChunk("valid"),
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    let errorCalled = false;

    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => {},
      onError: ()  => { errorCalled = true; },
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(errorCalled).toBe(false);       // 에러 없음
    expect(chunks).toContain("valid");     // 정상 청크는 처리됨
  });

  it("선행 \\n 청크 → 무시 (contentStarted 플래그)", async () => {
    fetchSpy.mockReturnValue(makeSSEStream([
      sseChunk("\n"),          // 선행 개행 — 무시되어야 함
      sseChunk("actual text"),
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => {},
      onError: ()  => {},
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(chunks).not.toContain("\n");       // 선행 \n 제외
    expect(chunks.join("")).toBe("actual text");
  });

  it("delta.content가 null → 무시", async () => {
    fetchSpy.mockReturnValue(makeSSEStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}\n\n`,
      sseChunk("real"),
      "data: [DONE]\n\n",
    ]));

    const chunks: string[] = [];
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => {},
      onError: ()  => {},
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(chunks.join("")).toBe("real");
  });

  it("청크 경계에서 data: 줄 분할 → 버퍼링으로 올바르게 처리", async () => {
    const fullLine = sseChunk("split text");
    const half1 = fullLine.slice(0, 20);
    const half2 = fullLine.slice(20) + "data: [DONE]\n\n";

    fetchSpy.mockReturnValue(makeSSEStream([half1, half2]));

    const chunks: string[] = [];
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: (c) => chunks.push(c),
      onDone:  ()  => {},
      onError: ()  => {},
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(chunks.join("")).toBe("split text");
  });

  it("HTTP 오류 → onError 호출, onDone 없음", async () => {
    fetchSpy.mockReturnValue(Promise.resolve(new Response(
      JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429 }
    )));

    let errorMsg = "";
    let doneCalled = false;

    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: ()  => {},
      onDone:  ()  => { doneCalled = true; },
      onError: (e) => { errorMsg = e; },
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(doneCalled).toBe(false);
    expect(errorMsg).toContain("Rate limit");
  });

  it("AbortError → onDone 호출 (onError 아님)", async () => {
    fetchSpy.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    let doneCalled = false;
    let errorCalled = false;

    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: ()  => {},
      onDone:  ()  => { doneCalled = true; },
      onError: ()  => { errorCalled = true; },
      modelOverride: "gpt-4o",
    });

    await vi.runAllTimersAsync();
    await p;
    expect(doneCalled).toBe(true);
    expect(errorCalled).toBe(false);
  });
});

// ── Provider 라우팅 ───────────────────────────────────────────────────────────

describe("streamChat — provider 라우팅", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockReturnValue(makeSSEStream(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("document", { hidden: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gpt-4o → provider:openai 로 전송", async () => {
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {}, onError: () => {},
      modelOverride: "gpt-4o",
    });
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("gpt-4o");
  });

  it("claude-sonnet-4-6 → provider:anthropic 로 전송", async () => {
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {}, onError: () => {},
      modelOverride: "claude-sonnet-4-6",
    });
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.provider).toBe("anthropic");
  });

  it("gemini-2.0-flash → provider:google 로 전송", async () => {
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {}, onError: () => {},
      modelOverride: "gemini-2.0-flash",
    });
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.provider).toBe("google");
  });

  it("알 수 없는 모델 → onError 호출, fetch 없음", async () => {
    let error = "";
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {},
      onError: (e) => { error = e; },
      modelOverride: "unknown-model-xyz",
    });
    await vi.runAllTimersAsync();
    await p;

    expect(error).toContain("Unknown model");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("temperature/maxTokens/topP가 요청 바디에 포함", async () => {
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {}, onError: () => {},
      modelOverride:       "gpt-4o",
      temperatureOverride: 0.3,
      maxTokensOverride:   512,
      topPOverride:        0.9,
    });
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.3);
    expect(body.maxTokens).toBe(512);
    expect(body.topP).toBe(0.9);
  });

  it("sysPrompt가 빈 문자열이면 undefined로 전송 (불필요한 필드 제거)", async () => {
    const p = streamChat({
      messages: [{ role: "user", content: "test" }],
      onChunk: () => {}, onDone: () => {}, onError: () => {},
      modelOverride: "gpt-4o",
    });
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // systemPrompt가 "" → sysPrompt: undefined → JSON.stringify로 필드 제거
    expect(body.sysPrompt).toBeUndefined();
  });
});
