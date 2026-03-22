/**
 * modelCapabilities 유닛 테스트
 *
 * 커버 항목:
 *  - OpenAI vision 모델 감지 (gpt-4o, gpt-4-turbo 등)
 *  - Anthropic vision 모델 감지 (claude-3*, claude-sonnet-*, 등)
 *  - Google vision 모델 감지 (gemini-*)
 *  - Ollama vision 모델 감지 (llava, bakllava, moondream 등)
 *  - vision=false 인 모델 (gpt-3.5-turbo, llama3.2 순수 텍스트 등)
 *  - tools 능력 감지 (gpt-4, claude-3, gemini, llama3, mistral 등)
 *  - tools=false 인 모델 (llava 등 순수 vision 모델)
 *  - 태그 우선: loadModels()에 Vision 태그 있으면 패턴 무관 vision=true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// appStore 모킹 — localStorage 의존성 제거
const mockModels: { id: string; tags: string[] }[] = [];
vi.mock("@/lib/appStore", () => ({
  loadModels: () => mockModels,
}));

// "use client" 디렉티브가 있는 모듈은 동적 import 필요
import { getModelCapabilities } from "../modelCapabilities";

beforeEach(() => {
  mockModels.length = 0;
});

// ── Vision capability ──────────────────────────────────────────────────────────

describe("vision capability — pattern matching", () => {
  const VISION_MODELS = [
    // OpenAI
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-vision-preview",
    "gpt-4-turbo",
    "o1",
    "o3-mini",
    "o4-mini",
    // Anthropic
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5",
    // Google
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-pro-vision",
    // Ollama vision models
    "llava",
    "llava:13b",
    "llava:34b",
    "bakllava",
    "moondream",
    "moondream2",
    "minicpm-v",
    "minicpmv",
    "cogvlm",
    "qwen2.5vl",
    "qwen-vl-chat",
    "llama3.2-vision",
    "phi3-vision",
  ];

  it.each(VISION_MODELS)('"%s" → vision=true', (modelId) => {
    expect(getModelCapabilities(modelId).vision).toBe(true);
  });

  const NON_VISION_MODELS = [
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-16k",
    "llama3.2",          // text-only llama
    "llama2",
    "mistral",
    "deepseek-coder",
    "codellama",
    "phi3",              // vision variant tested separately
    "qwen2",
  ];

  it.each(NON_VISION_MODELS)('"%s" → vision=false', (modelId) => {
    expect(getModelCapabilities(modelId).vision).toBe(false);
  });
});

// ── Tools capability ───────────────────────────────────────────────────────────

describe("tools capability — pattern matching", () => {
  const TOOLS_MODELS = [
    // OpenAI
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o3",
    "o4-mini",
    // Anthropic
    "claude-3-opus-20240229",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5",
    // Google
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    // Ollama tools models
    "llama3",
    "llama3.2",
    "llama3.1",
    "mistral",
    "mistral-7b",
    "qwen2",
    "qwen2.5",
    "deepseek-r1",
    "command-r",
    "command-r-plus",
  ];

  it.each(TOOLS_MODELS)('"%s" → tools=true', (modelId) => {
    expect(getModelCapabilities(modelId).tools).toBe(true);
  });

  const NO_TOOLS_MODELS = [
    "llava",           // vision-only model
    "bakllava",
    "moondream",
    "cogvlm",
  ];

  it.each(NO_TOOLS_MODELS)('"%s" → tools=false', (modelId) => {
    expect(getModelCapabilities(modelId).tools).toBe(false);
  });
});

// ── Tag registry 우선순위 ─────────────────────────────────────────────────────

describe("tag registry overrides pattern matching", () => {
  it("Vision 태그가 있으면 패턴 무관 vision=true", () => {
    mockModels.push({ id: "custom-llm", tags: ["Vision"] });
    expect(getModelCapabilities("custom-llm").vision).toBe(true);
  });

  it("tools 태그가 있으면 패턴 무관 tools=true", () => {
    mockModels.push({ id: "custom-llm", tags: ["tools"] });
    expect(getModelCapabilities("custom-llm").tools).toBe(true);
  });

  it("태그가 없으면 패턴 매칭 fallback 사용", () => {
    mockModels.push({ id: "gpt-4o", tags: [] });
    const caps = getModelCapabilities("gpt-4o");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
  });

  it("모델 ID가 registry에 없으면 패턴 매칭만 사용", () => {
    // mockModels 비어있음
    const caps = getModelCapabilities("claude-3-opus-20240229");
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
  });

  it("태그 매칭은 대소문자 구분 없음 (vision vs Vision vs VISION)", () => {
    mockModels.push({ id: "mymodel", tags: ["VISION"] });
    expect(getModelCapabilities("mymodel").vision).toBe(true);
  });
});

// ── 엣지 케이스 ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("빈 문자열 모델 ID → vision=false, tools=false", () => {
    const caps = getModelCapabilities("");
    expect(caps.vision).toBe(false);
    expect(caps.tools).toBe(false);
  });

  it("알 수 없는 모델 → vision=false, tools=false", () => {
    const caps = getModelCapabilities("totally-unknown-model-xyz");
    expect(caps.vision).toBe(false);
    expect(caps.tools).toBe(false);
  });

  it("모델 ID의 버전 suffix가 있어도 인식 (gpt-4o-2024-11-20)", () => {
    expect(getModelCapabilities("gpt-4o-2024-11-20").vision).toBe(true);
  });

  it("Ollama 태그 형식 (llava:13b) 인식", () => {
    expect(getModelCapabilities("llava:13b").vision).toBe(true);
  });
});
