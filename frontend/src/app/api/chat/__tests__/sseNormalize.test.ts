// @vitest-environment node
/**
 * normalizeToOpenAISse TransformStream 테스트
 *
 * 이 함수는 Anthropic/Google SSE 형식을 OpenAI 표준 SSE로 변환한다.
 * 변환 정확도가 스트리밍 품질의 핵심이다.
 *
 * 커버 항목:
 *  Anthropic SSE:
 *    - content_block_delta/text_delta → 텍스트 추출
 *    - 다른 이벤트 타입 (message_start 등) → 무시
 *    - delta.text가 null/undefined → 무시
 *
 *  Google SSE:
 *    - candidates[0].content.parts[0].text → 텍스트 추출
 *    - candidates 빈 배열 → 무시
 *    - parts 없음 → 무시
 *
 *  공통:
 *    - [DONE] 마커 → 스트림 종료 신호 전달
 *    - 빈 data 라인 → 무시
 *    - 잘못된 JSON → 무시 (스트림 중단 없음)
 *    - 여러 청크가 하나의 버퍼에 도착 → 모두 처리
 *    - 청크 경계에서 라인이 분할 → 버퍼링으로 처리
 *    - 출력 형식: data: {"choices":[{"delta":{"content":"..."}}]}
 */

import { describe, it, expect } from "vitest";
import { normalizeToOpenAISse } from "../route";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** TransformStream에 SSE 청크들을 넣고 출력을 모아 반환한다 */
async function runTransform(
  extractText: (data: string) => string | null,
  inputChunks: string[]
): Promise<string[]> {
  const xform = normalizeToOpenAISse(extractText);
  const writer = xform.writable.getWriter();
  const reader = xform.readable.getReader();

  const lines: string[] = [];

  // 읽기와 쓰기를 동시에 실행해야 TransformStream이 backpressure 없이 flush된다.
  const readPromise = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      dec.decode(value).split("\n").filter(Boolean).forEach(l => lines.push(l));
    }
  })();

  const writePromise = (async () => {
    for (const chunk of inputChunks) {
      await writer.write(enc.encode(chunk));
    }
    await writer.close();
  })();

  await Promise.all([readPromise, writePromise]);
  return lines;
}

/** data: {...} 라인에서 content 텍스트 추출 */
function extractContent(lines: string[]): string[] {
  return lines
    .filter(l => l.startsWith("data: ") && !l.includes("[DONE]"))
    .map(l => {
      const json = JSON.parse(l.slice(6));
      return json.choices?.[0]?.delta?.content ?? "";
    })
    .filter(Boolean);
}

// ── Anthropic SSE extractor ────────────────────────────────────────────────────

function anthropicExtractor(payload: string): string | null {
  const json = JSON.parse(payload) as {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
    return json.delta.text ?? null;
  }
  return null;
}

describe("Anthropic SSE 변환", () => {
  it("content_block_delta/text_delta → 텍스트 추출", async () => {
    const event = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
    const lines = await runTransform(anthropicExtractor, [`data: ${event}\n\n`]);
    const texts = extractContent(lines);
    expect(texts).toContain("Hello");
  });

  it("여러 청크 연속 → 순서대로 모두 추출", async () => {
    const makeEvent = (text: string) =>
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;

    const lines = await runTransform(anthropicExtractor, [
      makeEvent("안"),
      makeEvent("녕"),
      makeEvent("하"),
      makeEvent("세"),
      makeEvent("요"),
    ]);
    const texts = extractContent(lines);
    expect(texts).toEqual(["안", "녕", "하", "세", "요"]);
  });

  it("message_start 등 다른 이벤트 타입 → 무시", async () => {
    const events = [
      `data: ${JSON.stringify({ type: "message_start", message: {} })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start" })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ];
    const lines = await runTransform(anthropicExtractor, events);
    const texts = extractContent(lines);
    expect(texts).toEqual(["OK"]);  // 오직 실제 텍스트 이벤트만
  });

  it("delta.text가 undefined → 무시", async () => {
    const event = `data: ${JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta" },  // text 없음
    })}\n\n`;
    const lines = await runTransform(anthropicExtractor, [event]);
    const texts = extractContent(lines);
    expect(texts).toHaveLength(0);
  });
});

// ── Google SSE extractor ──────────────────────────────────────────────────────

function googleExtractor(payload: string): string | null {
  const json = JSON.parse(payload) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

describe("Google SSE 변환", () => {
  it("candidates[0].content.parts[0].text → 텍스트 추출", async () => {
    const event = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Gemini response" }] } }],
    });
    const lines = await runTransform(googleExtractor, [`data: ${event}\n\n`]);
    const texts = extractContent(lines);
    expect(texts).toContain("Gemini response");
  });

  it("빈 candidates → 무시", async () => {
    const event = `data: ${JSON.stringify({ candidates: [] })}\n\n`;
    const lines = await runTransform(googleExtractor, [event]);
    const texts = extractContent(lines);
    expect(texts).toHaveLength(0);
  });

  it("parts 없음 → 무시", async () => {
    const event = `data: ${JSON.stringify({
      candidates: [{ content: {} }],
    })}\n\n`;
    const lines = await runTransform(googleExtractor, [event]);
    const texts = extractContent(lines);
    expect(texts).toHaveLength(0);
  });

  it("여러 청크 → 순서대로 추출", async () => {
    const makeEvent = (text: string) =>
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

    const lines = await runTransform(googleExtractor, [
      makeEvent("First"),
      makeEvent(" Second"),
      makeEvent(" Third"),
    ]);
    const texts = extractContent(lines);
    expect(texts).toEqual(["First", " Second", " Third"]);
  });
});

// ── 공통 동작 ─────────────────────────────────────────────────────────────────

describe("공통 SSE 처리", () => {
  const trivialExtractor = (payload: string): string | null => {
    try { return (JSON.parse(payload) as { text: string }).text ?? null; } catch { return null; }
  };

  it("[DONE] 마커 → 출력 스트림에 [DONE] 포함", async () => {
    const lines = await runTransform(trivialExtractor, [
      `data: ${JSON.stringify({ text: "hi" })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    expect(lines.some(l => l.includes("[DONE]"))).toBe(true);
  });

  it("빈 data 라인 → 무시", async () => {
    const lines = await runTransform(trivialExtractor, [
      "data: \n\n",
      `data: ${JSON.stringify({ text: "real" })}\n\n`,
    ]);
    const texts = extractContent(lines);
    expect(texts).toEqual(["real"]);
  });

  it("잘못된 JSON → 무시 (스트림 중단 없음)", async () => {
    const lines = await runTransform(trivialExtractor, [
      "data: {INVALID JSON\n\n",
      `data: ${JSON.stringify({ text: "after error" })}\n\n`,
    ]);
    const texts = extractContent(lines);
    expect(texts).toContain("after error");  // 에러 이후도 계속 처리
  });

  it("data: 접두사 없는 라인 → 무시", async () => {
    const lines = await runTransform(trivialExtractor, [
      "event: content_block\n",
      `data: ${JSON.stringify({ text: "valid" })}\n\n`,
    ]);
    const texts = extractContent(lines);
    expect(texts).toEqual(["valid"]);
  });

  it("청크 경계에서 라인 분할 → 버퍼링으로 올바르게 처리", async () => {
    // 하나의 SSE 라인이 두 청크로 나뉘어 전달
    const fullEvent = `data: ${JSON.stringify({ text: "split" })}\n\n`;
    const half1 = fullEvent.slice(0, fullEvent.length / 2);
    const half2 = fullEvent.slice(fullEvent.length / 2);

    const lines = await runTransform(trivialExtractor, [half1, half2]);
    const texts = extractContent(lines);
    expect(texts).toContain("split");
  });

  it("출력은 표준 OpenAI SSE 형식", async () => {
    const lines = await runTransform(trivialExtractor, [
      `data: ${JSON.stringify({ text: "test" })}\n\n`,
    ]);
    const dataLines = lines.filter(l => l.startsWith("data: ") && !l.includes("[DONE]"));
    expect(dataLines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(dataLines[0].slice(6));
    expect(parsed).toHaveProperty("choices");
    expect(parsed.choices[0]).toHaveProperty("delta");
    expect(parsed.choices[0].delta).toHaveProperty("content");
  });
});
