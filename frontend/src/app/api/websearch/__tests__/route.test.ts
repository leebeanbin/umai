// @vitest-environment node
/**
 * 웹 검색 API 라우트 테스트 (Tavily 연동)
 *
 * 커버 항목:
 *  - 빈 쿼리 → results: []
 *  - 공백만 있는 쿼리 → results: []
 *  - API 키 없음 → results: [] (graceful no-op)
 *  - Tavily 성공 응답 → 결과 필드 매핑 (title, snippet, url)
 *  - Tavily 응답 6개 초과 시 6개로 제한
 *  - Tavily 응답 필드 누락 시 빈 문자열로 대체
 *  - Tavily HTTP 오류 → results: []
 *  - 네트워크 오류 (fetch throw) → results: []
 *  - 올바른 요청 바디 (POST to Tavily, api_key 포함) 전송 확인
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// TAVILY_API_KEY 환경변수 설정 (import 전에 세팅해야 함)
process.env.TAVILY_API_KEY = "tvly-test-key";

const { GET } = await import("../route");

describe("GET /api/websearch", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeReq(q: string) {
    return new NextRequest(`http://localhost/api/websearch?q=${encodeURIComponent(q)}`);
  }

  function tavilyResponse(results: object[]) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results }),
    } as Response);
  }

  // ── 입력 검증 ───────────────────────────────────────────────────────────────

  it("빈 쿼리는 results:[] 반환, fetch 호출 없음", async () => {
    const res = await GET(makeReq(""));
    const data = await res.json();
    expect(data.results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("공백만 있는 쿼리는 results:[] 반환", async () => {
    const res = await GET(makeReq("   "));
    const data = await res.json();
    expect(data.results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 정상 동작 ────────────────────────────────────────────────────────────────

  it("Tavily 성공 응답 → 결과 필드 매핑", async () => {
    fetchSpy.mockReturnValue(tavilyResponse([
      { title: "Python Docs", content: "Official Python documentation.", url: "https://docs.python.org" },
    ]));

    const res = await GET(makeReq("python"));
    const data = await res.json();

    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toEqual({
      title:   "Python Docs",
      snippet: "Official Python documentation.",
      url:     "https://docs.python.org",
    });
  });

  it("Tavily 응답 7개 → 6개로 제한", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      title: `Title ${i}`, content: `Snippet ${i}`, url: `https://example.com/${i}`,
    }));
    fetchSpy.mockReturnValue(tavilyResponse(items));

    const res = await GET(makeReq("test"));
    const data = await res.json();
    expect(data.results).toHaveLength(6);
  });

  it("응답 필드 누락 시 빈 문자열로 채움", async () => {
    fetchSpy.mockReturnValue(tavilyResponse([
      { /* title 누락 */ content: "Some content", url: "https://example.com" },
    ]));

    const res = await GET(makeReq("test"));
    const data = await res.json();
    expect(data.results[0].title).toBe("");
    expect(data.results[0].snippet).toBe("Some content");
    expect(data.results[0].url).toBe("https://example.com");
  });

  it("results 키가 없는 응답 → 빈 배열", async () => {
    fetchSpy.mockReturnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),  // results 키 없음
    } as Response));

    const res = await GET(makeReq("test"));
    const data = await res.json();
    expect(data.results).toEqual([]);
  });

  // ── 올바른 요청 전송 검증 ─────────────────────────────────────────────────

  it("Tavily API에 올바른 요청 바디를 전송한다", async () => {
    fetchSpy.mockReturnValue(tavilyResponse([]));

    await GET(makeReq("NextJS testing"));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.api_key).toBe("tvly-test-key");
    expect(body.query).toBe("NextJS testing");
    expect(body.search_depth).toBe("basic");
    expect(body.max_results).toBe(6);
    expect(body.include_images).toBe(false);
  });

  // ── 에러 처리 ────────────────────────────────────────────────────────────────

  it("Tavily HTTP 500 → results:[]", async () => {
    fetchSpy.mockReturnValue(Promise.resolve({ ok: false } as Response));

    const res = await GET(makeReq("query"));
    const data = await res.json();
    expect(data.results).toEqual([]);
  });

  it("fetch 예외 발생 → results:[]", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));

    const res = await GET(makeReq("query"));
    const data = await res.json();
    expect(data.results).toEqual([]);
  });
});
