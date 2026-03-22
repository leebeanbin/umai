// @vitest-environment node
/**
 * parseDataUrl 유틸 단위 테스트
 *
 * 커버 항목:
 *  - 정상 JPEG data URL 파싱
 *  - 정상 PNG data URL 파싱
 *  - 정상 WebP data URL 파싱
 *  - base64 콤마 없는 URL → mimeType 기본값 image/jpeg, data = 원본 문자열
 *  - 빈 문자열 → 기본값
 *  - 긴 base64 데이터 유지 (잘림 없음)
 *  - mimeType 정확히 추출 (image/png vs image/jpeg 혼동 없음)
 */

import { describe, it, expect } from "vitest";
import { parseDataUrl } from "../route";

describe("parseDataUrl", () => {
  it("JPEG data URL을 올바르게 파싱한다", () => {
    const result = parseDataUrl("data:image/jpeg;base64,/9j/ABC123==");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.data).toBe("/9j/ABC123==");
  });

  it("PNG data URL을 올바르게 파싱한다", () => {
    const result = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toBe("iVBORw0KGgo=");
  });

  it("WebP data URL을 올바르게 파싱한다", () => {
    const result = parseDataUrl("data:image/webp;base64,UklGR==");
    expect(result.mimeType).toBe("image/webp");
    expect(result.data).toBe("UklGR==");
  });

  it("GIF data URL을 올바르게 파싱한다", () => {
    const result = parseDataUrl("data:image/gif;base64,R0lGOD==");
    expect(result.mimeType).toBe("image/gif");
    expect(result.data).toBe("R0lGOD==");
  });

  it("잘못된 형식 → mimeType 기본값 image/jpeg, data = 원본 문자열", () => {
    const raw = "not-a-data-url";
    const result = parseDataUrl(raw);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.data).toBe(raw);
  });

  it("빈 문자열 → 기본값 반환", () => {
    const result = parseDataUrl("");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.data).toBe("");
  });

  it("긴 base64 데이터를 잘리지 않고 반환한다", () => {
    const longBase64 = "A".repeat(10000);
    const result = parseDataUrl(`data:image/jpeg;base64,${longBase64}`);
    expect(result.data).toBe(longBase64);
    expect(result.data.length).toBe(10000);
  });

  it("mimeType이 정확히 구분된다 (PNG vs JPEG 혼동 없음)", () => {
    const png = parseDataUrl("data:image/png;base64,ABC");
    const jpg = parseDataUrl("data:image/jpeg;base64,ABC");
    expect(png.mimeType).not.toBe(jpg.mimeType);
    expect(png.mimeType).toBe("image/png");
    expect(jpg.mimeType).toBe("image/jpeg");
  });

  it("base64 데이터에 = padding이 있어도 정확히 추출한다", () => {
    const result = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(result.data).toBe("iVBORw0KGgo=");
  });

  it("base64 콤마 이후 슬래시/플러스 포함 데이터도 정확히 추출한다", () => {
    const result = parseDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRgAB+A==");
    expect(result.data).toBe("/9j/4AAQSkZJRgAB+A==");
  });
});
