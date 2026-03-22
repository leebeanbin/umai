// @vitest-environment node
/**
 * OCR API 라우트 테스트 (Ollama llava 연동)
 *
 * 커버 항목:
 *  - image 필드 없음 → text: ""
 *  - Ollama 성공 → 텍스트 추출 및 trim
 *  - base64 data URL 프리픽스 제거 검증
 *  - 커스텀 prompt 파라미터 전달
 *  - 커스텀 model 파라미터 전달
 *  - 기본 model은 "llava"
 *  - stream: false, temperature: 0 고정 전송
 *  - Ollama HTTP 오류 → text: ""
 *  - 네트워크 오류 → text: ""
 *  - 응답 response 키 없음 → text: ""
 *  - 응답 텍스트 앞뒤 공백 trim
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

process.env.OLLAMA_URL = "http://localhost:11434";
process.env.OCR_MODEL  = "llava";

const { POST } = await import("../route");

describe("POST /api/ocr", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeReq(body: object) {
    return new NextRequest("http://localhost/api/ocr", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  function ollamaOk(response: string) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ response }),
    } as Response);
  }

  // ── 입력 검증 ────────────────────────────────────────────────────────────────

  it("image 필드 없으면 text:'' 반환, fetch 호출 없음", async () => {
    const res = await POST(makeReq({}));
    const data = await res.json();
    expect(data.text).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("image가 빈 문자열이면 text:'' 반환", async () => {
    const res = await POST(makeReq({ image: "" }));
    const data = await res.json();
    expect(data.text).toBe("");
  });

  // ── 정상 동작 ────────────────────────────────────────────────────────────────

  it("Ollama 성공 → response 텍스트 반환", async () => {
    fetchSpy.mockReturnValue(ollamaOk("Hello World extracted text"));

    const res = await POST(makeReq({ image: "data:image/jpeg;base64,/9j/ABC" }));
    const data = await res.json();
    expect(data.text).toBe("Hello World extracted text");
  });

  it("응답 앞뒤 공백을 trim한다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("  extracted text  \n"));

    const res = await POST(makeReq({ image: "data:image/jpeg;base64,/9j/ABC" }));
    const data = await res.json();
    expect(data.text).toBe("extracted text");
  });

  // ── 요청 파라미터 검증 ────────────────────────────────────────────────────

  it("data URL 프리픽스를 제거하고 순수 base64만 Ollama에 전송한다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({ image: "data:image/png;base64,iVBORw0KGgo=" }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.images[0]).toBe("iVBORw0KGgo=");
    expect(body.images[0]).not.toContain("data:");
  });

  it("기본 model은 'llava'", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe("llava");
  });

  it("커스텀 model 파라미터가 전달된다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({ image: "data:image/jpeg;base64,ABC", model: "llava:13b" }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe("llava:13b");
  });

  it("커스텀 prompt 파라미터가 전달된다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({
      image:  "data:image/jpeg;base64,ABC",
      prompt: "Read all Korean text in this image.",
    }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.prompt).toBe("Read all Korean text in this image.");
  });

  it("stream:false, temperature:0 고정값이 전송된다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0);
  });

  it("올바른 Ollama URL로 요청이 간다", async () => {
    fetchSpy.mockReturnValue(ollamaOk("text"));

    await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));

    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:11434/api/generate");
  });

  // ── 에러 처리 ────────────────────────────────────────────────────────────────

  it("Ollama HTTP 오류 → text:''", async () => {
    fetchSpy.mockReturnValue(Promise.resolve({ ok: false } as Response));

    const res = await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));
    const data = await res.json();
    expect(data.text).toBe("");
  });

  it("fetch 예외 발생 → text:''", async () => {
    fetchSpy.mockRejectedValue(new Error("Ollama unreachable"));

    const res = await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));
    const data = await res.json();
    expect(data.text).toBe("");
  });

  it("응답에 response 키 없음 → text:''", async () => {
    fetchSpy.mockReturnValue(Promise.resolve({
      ok:   true,
      json: () => Promise.resolve({ no_response_key: true }),
    } as Response));

    const res = await POST(makeReq({ image: "data:image/jpeg;base64,ABC" }));
    const data = await res.json();
    expect(data.text).toBe("");
  });
});
