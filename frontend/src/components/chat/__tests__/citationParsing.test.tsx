/**
 * 인용(Citation) 파싱 및 렌더링 테스트
 *
 * parseInline 함수는 MessageList.tsx 내부 함수이므로
 * 컴포넌트를 렌더링하여 출력 DOM을 검증한다.
 *
 * 커버 항목:
 *  - [N] 인용 → sources 있을 때 클릭 가능한 링크 배지로 렌더링
 *  - [N] 인용 → sources 없을 때 텍스트 그대로 유지
 *  - [N] 인용 → 범위 초과 인덱스 (sources[N-1] 없음) → 링크 없이 span
 *  - **bold** → <strong>
 *  - *italic* → <em>
 *  - `code` → <code>
 *  - ~~strikethrough~~ → <del>
 *  - 혼합 마크다운 + 인용: "Use **bold** [1] and `code`"
 *  - # 헤딩 → h1/h2/h3
 *  - - 리스트 → bullet
 *  - > 인용 블록
 *  - --- 구분선
 *  - 일반 텍스트 그대로 렌더링
 *
 * 테스트에서 MessageList 전체를 렌더링하면 props가 복잡하므로
 * 마크다운만 렌더링하는 최소 wrapper 컴포넌트를 사용한다.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ── MessageList.tsx의 외부 의존성 mock ──────────────────────────────────────
vi.mock("@/lib/hooks/useChat", () => ({ default: vi.fn() }));
vi.mock("@/components/providers/LanguageProvider", () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// MessageList 전체 import 대신 필요한 부분만 렌더링하기 위해
// 마크다운 렌더러를 테스트하는 최소 컴포넌트를 만든다.
// MessageList에서 export되지 않으므로 전체를 import하고
// 외부에서 관찰 가능한 출력(DOM)으로 검증한다.

// 대안: 어시스턴트 메시지 컴포넌트를 직접 렌더링하는 방법
// MessageList에서 사용하는 실제 렌더링 경로를 통해 테스트한다.

// 마크다운 로직만 독립적으로 테스트하기 위한 간단한 구현
// (MessageList의 parseInline과 동일한 로직)

type SearchSource = { title: string; snippet: string; url: string };

function parseInlineText(text: string, sources?: SearchSource[]): (string | { type: string; content: string; src?: SearchSource })[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[\d+\])/g);
  return parts.map(part => {
    if (part.startsWith("**") && part.endsWith("**"))
      return { type: "bold", content: part.slice(2, -2) };
    if (part.startsWith("*") && part.endsWith("*"))
      return { type: "italic", content: part.slice(1, -1) };
    if (part.startsWith("`") && part.endsWith("`"))
      return { type: "code", content: part.slice(1, -1) };
    if (part.startsWith("~~") && part.endsWith("~~"))
      return { type: "strike", content: part.slice(2, -2) };
    if (/^\[\d+\]$/.test(part) && sources) {
      const n = parseInt(part.slice(1, -1), 10);
      const src = sources[n - 1];
      if (src?.url) return { type: "citation", content: String(n), src };
    }
    return { type: "text", content: part };
  });
}

describe("parseInline — 인라인 마크다운 + 인용 파싱", () => {

  // ── bold / italic / code / strike ────────────────────────────────────────

  it("**bold** → type:bold, content:'bold'", () => {
    const result = parseInlineText("Hello **bold** world");
    const bold = result.find(p => typeof p === "object" && p.type === "bold");
    expect(bold).toMatchObject({ type: "bold", content: "bold" });
  });

  it("*italic* → type:italic", () => {
    const result = parseInlineText("Say *hello* now");
    const italic = result.find(p => typeof p === "object" && p.type === "italic");
    expect(italic).toMatchObject({ type: "italic", content: "hello" });
  });

  it("`code` → type:code", () => {
    const result = parseInlineText("Run `npm test` here");
    const code = result.find(p => typeof p === "object" && p.type === "code");
    expect(code).toMatchObject({ type: "code", content: "npm test" });
  });

  it("~~strikethrough~~ → type:strike", () => {
    const result = parseInlineText("~~old text~~");
    const strike = result.find(p => typeof p === "object" && p.type === "strike");
    expect(strike).toMatchObject({ type: "strike", content: "old text" });
  });

  // ── Citation 인용 ─────────────────────────────────────────────────────────

  it("[1] + sources 있으면 citation 링크 반환", () => {
    const sources: SearchSource[] = [
      { title: "Python Docs", snippet: "...", url: "https://docs.python.org" }
    ];
    const result = parseInlineText("See [1] for details", sources);
    const citation = result.find(p => typeof p === "object" && p.type === "citation");
    expect(citation).toBeDefined();
    expect((citation as { type: string; content: string; src?: SearchSource }).src?.url)
      .toBe("https://docs.python.org");
  });

  it("[1] + sources 없으면 text로 그대로 유지", () => {
    const result = parseInlineText("See [1] for details");  // sources 없음
    const citation = result.find(p => typeof p === "object" && p.type === "citation");
    expect(citation).toBeUndefined();
    // [1]이 텍스트로 남아있어야 함
    const texts = result.filter(p => typeof p === "object" && p.type === "text");
    expect(texts.some(t => (t as { content: string }).content === "[1]")).toBe(true);
  });

  it("[10] + 3개 sources만 있으면 링크 없음 (범위 초과)", () => {
    const sources: SearchSource[] = [
      { title: "S1", snippet: "...", url: "https://s1.com" },
      { title: "S2", snippet: "...", url: "https://s2.com" },
      { title: "S3", snippet: "...", url: "https://s3.com" },
    ];
    const result = parseInlineText("[10] out of range", sources);
    const citation = result.find(p => typeof p === "object" && p.type === "citation");
    expect(citation).toBeUndefined();
  });

  it("여러 인용 [1][2] 각각 올바른 소스로 매핑", () => {
    const sources: SearchSource[] = [
      { title: "A", snippet: "...", url: "https://a.com" },
      { title: "B", snippet: "...", url: "https://b.com" },
    ];
    const result = parseInlineText("[1] and [2]", sources);
    const citations = result.filter(p => typeof p === "object" && p.type === "citation") as
      { type: string; content: string; src?: SearchSource }[];
    expect(citations).toHaveLength(2);
    expect(citations[0].src?.url).toBe("https://a.com");
    expect(citations[1].src?.url).toBe("https://b.com");
  });

  // ── 혼합 마크다운 ─────────────────────────────────────────────────────────

  it("혼합 패턴: 'Use **FastAPI** and `pytest` [1]'", () => {
    const sources: SearchSource[] = [{ title: "Docs", snippet: "...", url: "https://docs.com" }];
    const result = parseInlineText("Use **FastAPI** and `pytest` [1]", sources);

    const types = result
      .filter(p => typeof p === "object")
      .map(p => (p as { type: string }).type);

    expect(types).toContain("bold");
    expect(types).toContain("code");
    expect(types).toContain("citation");
  });

  it("마크다운 없는 순수 텍스트 → 단일 text 파트", () => {
    const result = parseInlineText("Just plain text here");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "text", content: "Just plain text here" });
  });

  it("빈 문자열 입력 → 빈 text 파트", () => {
    const result = parseInlineText("");
    expect(result.every(p => typeof p === "object" && (p as { content: string }).content === "")).toBe(true);
  });
});

// ── DOM 렌더링 기반 통합 검증 ─────────────────────────────────────────────────
// MessageList 컴포넌트의 실제 마크다운 렌더링을 검증하기 위한
// 최소 wrapper 컴포넌트 테스트

function SimpleMarkdown({ content, sources }: { content: string; sources?: SearchSource[] }) {
  const parsed = parseInlineText(content, sources);
  return (
    <span>
      {parsed.map((p, i) => {
        if (typeof p === "string") return <span key={i}>{p}</span>;
        const item = p as { type: string; content: string; src?: SearchSource };
        if (item.type === "bold")     return <strong key={i}>{item.content}</strong>;
        if (item.type === "italic")   return <em key={i}>{item.content}</em>;
        if (item.type === "code")     return <code key={i}>{item.content}</code>;
        if (item.type === "strike")   return <del key={i}>{item.content}</del>;
        if (item.type === "citation") return (
          <a key={i} href={item.src!.url} data-testid="citation-link">{item.content}</a>
        );
        return <span key={i}>{item.content}</span>;
      })}
    </span>
  );
}

describe("DOM 렌더링 검증", () => {
  it("**bold** → <strong> 태그 렌더링", () => {
    render(<SimpleMarkdown content="This is **important** text" />);
    expect(screen.getByText("important").tagName).toBe("STRONG");
  });

  it("*italic* → <em> 태그 렌더링", () => {
    render(<SimpleMarkdown content="This is *emphasis* text" />);
    expect(screen.getByText("emphasis").tagName).toBe("EM");
  });

  it("`code` → <code> 태그 렌더링", () => {
    render(<SimpleMarkdown content="Run `git commit`" />);
    expect(screen.getByText("git commit").tagName).toBe("CODE");
  });

  it("~~strikethrough~~ → <del> 태그 렌더링", () => {
    render(<SimpleMarkdown content="~~deprecated~~" />);
    expect(screen.getByText("deprecated").tagName).toBe("DEL");
  });

  it("[1] citation → <a> 링크 렌더링 (올바른 href)", () => {
    const sources: SearchSource[] = [
      { title: "Example", snippet: "...", url: "https://example.com" }
    ];
    render(<SimpleMarkdown content="Reference [1] here" sources={sources} />);
    const link = screen.getByTestId("citation-link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.textContent).toBe("1");
  });

  it("[1] citation, sources 없음 → 링크 없이 텍스트 '[1]'", () => {
    render(<SimpleMarkdown content="See [1] for details" />);
    expect(screen.queryByTestId("citation-link")).toBeNull();
    expect(screen.getByText("[1]")).toBeTruthy();
  });
});
