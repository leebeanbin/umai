// @vitest-environment node
/**
 * Chat API 라우트 — provider별 vision 메시지 포맷 변환 테스트
 *
 * 각 provider는 이미지를 다른 형식으로 변환한다:
 *   OpenAI/Ollama : content = [{ type:"image_url", image_url:{url} }, { type:"text", text }]
 *   Anthropic     : content = [{ type:"image", source:{type:"base64", media_type, data} }, { type:"text" }]
 *   Google        : parts   = [{ inlineData:{mimeType, data} }, { text }]
 *
 * 테스트 전략:
 *   - POST 핸들러를 직접 호출하되, 업스트림 fetch를 vi.stubGlobal로 차단
 *   - 업스트림에 전달된 request body를 캡처해서 포맷 검증
 *   - SSE 스트림 응답은 최소 mock으로 처리
 *
 * 커버 항목:
 *  OpenAI:
 *    - 이미지 있는 user 메시지 → image_url content array
 *    - 복수 이미지 → 모두 포함
 *    - 이미지 없는 메시지 → string content 그대로
 *    - assistant 메시지 이미지 → 무시됨
 *  Anthropic:
 *    - data URL → base64 분리 + media_type 추출
 *    - system 메시지 필터링
 *    - 복수 이미지
 *  Ollama:
 *    - OpenAI content array 형식 (image_url) 사용 확인
 *  Google:
 *    - inlineData 형식 + role 매핑 (assistant→model)
 *    - model ID에 models/ 접두사 자동 추가
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// 환경 변수 설정 (import 전에)
process.env.OPENAI_API_KEY    = "sk-test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.GOOGLE_API_KEY    = "google-test-key";
process.env.OLLAMA_URL        = "http://localhost:11434";

const { POST } = await import("../route");

const FAKE_JPEG = "data:image/jpeg;base64,/9j/FAKEJPEGDATA==";
const FAKE_PNG  = "data:image/png;base64,iVBORw0FAKEPNGDATA==";

/** SSE 스트림 형태의 mock 응답 생성 */
function sseResponse(text = "test response") {
  const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  const done = "data: [DONE]\n\n";
  const body = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(chunk + done));
      ctrl.close();
    },
  });
  return Promise.resolve(new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
}

function makePostReq(body: object) {
  return new NextRequest("http://localhost/api/chat", {
    method:  "POST",
    body:    JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("Chat route — vision message format", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockReturnValue(sseResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── OpenAI ────────────────────────────────────────────────────────────────

  describe("OpenAI provider", () => {
    const base = { provider: "openai", model: "gpt-4o" };

    it("이미지 있는 user 메시지 → image_url content array", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "What is this?", images: [FAKE_JPEG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");

      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[0]).toMatchObject({ type: "image_url", image_url: { url: FAKE_JPEG } });
      expect(userMsg.content[1]).toMatchObject({ type: "text", text: "What is this?" });
    });

    it("복수 이미지 → content array에 모두 포함", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Compare these", images: [FAKE_JPEG, FAKE_PNG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");

      const imageItems = userMsg.content.filter((c: { type: string }) => c.type === "image_url");
      expect(imageItems).toHaveLength(2);
      expect(imageItems[0].image_url.url).toBe(FAKE_JPEG);
      expect(imageItems[1].image_url.url).toBe(FAKE_PNG);
    });

    it("이미지 없는 메시지 → string content 그대로", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Hello" }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");
      expect(userMsg.content).toBe("Hello");
    });

    it("assistant 메시지의 images 필드는 무시됨", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "assistant", content: "I see it", images: [FAKE_JPEG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: { role: string }) => m.role === "assistant");
      expect(assistantMsg.content).toBe("I see it");
    });
  });

  // ── Anthropic ─────────────────────────────────────────────────────────────

  describe("Anthropic provider", () => {
    const base = { provider: "anthropic", model: "claude-3-sonnet-20240229" };

    it("이미지 → base64 source 형식으로 변환", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Describe image", images: [FAKE_JPEG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");

      expect(Array.isArray(userMsg.content)).toBe(true);
      const imageItem = userMsg.content[0];
      expect(imageItem.type).toBe("image");
      expect(imageItem.source.type).toBe("base64");
      expect(imageItem.source.media_type).toBe("image/jpeg");
      expect(imageItem.source.data).toBe("/9j/FAKEJPEGDATA==");

      const textItem = userMsg.content[1];
      expect(textItem.type).toBe("text");
      expect(textItem.text).toBe("Describe image");
    });

    it("PNG 이미지 → media_type이 image/png", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Check PNG", images: [FAKE_PNG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");
      expect(userMsg.content[0].source.media_type).toBe("image/png");
    });

    it("system 메시지는 messages 배열에서 필터링됨", async () => {
      await POST(makePostReq({
        ...base,
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user",   content: "Hi" },
        ],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const systemInMessages = body.messages.some((m: { role: string }) => m.role === "system");
      expect(systemInMessages).toBe(false);
    });

    it("복수 이미지 → 모두 source 형식으로 변환", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Two images", images: [FAKE_JPEG, FAKE_PNG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");
      const imageItems = userMsg.content.filter((c: { type: string }) => c.type === "image");
      expect(imageItems).toHaveLength(2);
    });
  });

  // ── Ollama ────────────────────────────────────────────────────────────────

  describe("Ollama provider", () => {
    const base = { provider: "ollama", model: "llava:13b" };

    it("이미지 → OpenAI 형식의 image_url content array (native images 필드 아님)", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "What is this?", images: [FAKE_JPEG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userMsg = body.messages.find((m: { role: string }) => m.role === "user");

      // content array 형식이어야 함 (native images 필드가 아님)
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.images).toBeUndefined();  // 루트 images 필드 없어야 함

      const imageItem = userMsg.content[0];
      expect(imageItem.type).toBe("image_url");
      expect(imageItem.image_url.url).toBe(FAKE_JPEG);  // 전체 data URL (base64만 아님)
    });

    it("/v1/chat/completions 엔드포인트로 요청", async () => {
      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Hello" }],
      }));

      expect(fetchSpy.mock.calls[0][0]).toContain("/v1/chat/completions");
    });
  });

  // ── Google ────────────────────────────────────────────────────────────────

  describe("Google provider", () => {
    const base = { provider: "google", model: "gemini-2.0-flash" };

    it("이미지 → inlineData 형식으로 변환", async () => {
      // Google SSE 형식으로 mock 조정
      fetchSpy.mockReturnValue(Promise.resolve(new Response(
        new ReadableStream({ start(ctrl) {
          const chunk = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })}\n\n`;
          ctrl.enqueue(new TextEncoder().encode(chunk));
          ctrl.close();
        }}),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )));

      await POST(makePostReq({
        ...base,
        messages: [{ role: "user", content: "Describe", images: [FAKE_PNG] }],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const userParts = body.contents.find((c: { role: string }) => c.role === "user")?.parts;

      expect(userParts).toBeDefined();
      const imageItem = userParts.find((p: { inlineData?: object }) => p.inlineData);
      expect(imageItem?.inlineData?.mimeType).toBe("image/png");
      expect(imageItem?.inlineData?.data).toBe("iVBORw0FAKEPNGDATA==");
    });

    it("assistant role → 'model' role로 변환", async () => {
      fetchSpy.mockReturnValue(Promise.resolve(new Response(
        new ReadableStream({ start(ctrl) { ctrl.close(); }}),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )));

      await POST(makePostReq({
        ...base,
        messages: [
          { role: "user",      content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
      }));

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const roles = body.contents.map((c: { role: string }) => c.role);
      expect(roles).toContain("model");
      expect(roles).not.toContain("assistant");
    });

    it("model ID에 'models/' 접두사 자동 추가", async () => {
      fetchSpy.mockReturnValue(sseResponse());

      await POST(makePostReq({
        ...base,
        model: "gemini-2.0-flash",  // models/ 없음
        messages: [{ role: "user", content: "Hi" }],
      }));

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("models/gemini-2.0-flash");
    });

    it("이미 'models/' 접두사 있으면 중복 추가 안 함", async () => {
      fetchSpy.mockReturnValue(sseResponse());

      await POST(makePostReq({
        ...base,
        model: "models/gemini-2.0-flash",
        messages: [{ role: "user", content: "Hi" }],
      }));

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain("models/models/");
    });
  });
});
