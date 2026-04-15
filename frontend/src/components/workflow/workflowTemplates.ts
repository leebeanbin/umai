import type { Node, Edge } from "@xyflow/react";

export interface WorkflowTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** 멀티모델 분산 실행 등 고급 패턴 여부 */
  advanced?: boolean;
  nodes: Omit<Node, "selected">[];
  edges: Edge[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 기본 챗봇
// ─────────────────────────────────────────────────────────────────────────────
const basicChatbot: WorkflowTemplate = {
  id: "basic-chatbot",
  name: "기본 챗봇",
  emoji: "💬",
  description: "사용자 입력 → LLM 응답 → 출력",
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 100 },
      data: { label: "Input", fields: [{ key: "user_input", type: "text" }] },
    },
    {
      id: "_llm", type: "llm",
      position: { x: 280, y: 100 },
      data: {
        label: "GPT-4o",
        provider: "openai", model: "gpt-4o",
        system_prompt: "You are a helpful assistant.",
        user_message: "{{user_input}}",
        output_key: "response",
        temperature: 0.7, max_steps: 10, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 580, y: 100 },
      data: { label: "Output", output_key: "response" },
    },
  ],
  edges: [
    { id: "_e1", source: "_in",  target: "_llm", animated: false },
    { id: "_e2", source: "_llm", target: "_out", animated: false },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. 웹 리서치 에이전트
// ─────────────────────────────────────────────────────────────────────────────
const webResearch: WorkflowTemplate = {
  id: "web-research",
  name: "웹 리서치 에이전트",
  emoji: "🔍",
  description: "검색 → LLM 요약 → 출력",
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 100 },
      data: { label: "Input", fields: [{ key: "query", type: "string" }] },
    },
    {
      id: "_tool", type: "tool",
      position: { x: 280, y: 100 },
      data: {
        label: "Web Search",
        tool_name: "web_search",
        args: { query: "{{query}}" },
        output_key: "search_result",
      },
    },
    {
      id: "_llm", type: "llm",
      position: { x: 560, y: 100 },
      data: {
        label: "요약 LLM",
        provider: "openai", model: "gpt-4o",
        system_prompt: "검색 결과를 바탕으로 간결하게 정리해주세요.",
        user_message: "검색 결과:\n{{search_result}}\n\n질문: {{query}}",
        output_key: "summary",
        temperature: 0.3, max_steps: 5, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 840, y: 100 },
      data: { label: "Output", output_key: "summary" },
    },
  ],
  edges: [
    { id: "_e1", source: "_in",   target: "_tool" },
    { id: "_e2", source: "_tool", target: "_llm" },
    { id: "_e3", source: "_llm",  target: "_out" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. 멀티 모델 하네스 (핵심!)
//    동일 프롬프트를 OpenAI·Anthropic·Google 에 병렬 전송 → 집계 LLM → 출력
// ─────────────────────────────────────────────────────────────────────────────
const multiModelHarness: WorkflowTemplate = {
  id: "multi-model-harness",
  name: "멀티 모델 하네스",
  emoji: "⚡",
  description: "GPT-4o + Claude + Gemini 병렬 실행 후 최적 답변 선택",
  advanced: true,
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 200 },
      data: { label: "Input", fields: [{ key: "prompt", type: "text" }] },
    },
    // ── 병렬 LLM 3개 ──────────────────────────────────────────────────────
    {
      id: "_gpt4", type: "llm",
      position: { x: 280, y: 0 },
      data: {
        label: "GPT-4o",
        provider: "openai", model: "gpt-4o",
        system_prompt: "You are a helpful expert assistant.",
        user_message: "{{prompt}}",
        output_key: "gpt4_answer",
        temperature: 0.7, max_steps: 10, tools: [],
      },
    },
    {
      id: "_claude", type: "llm",
      position: { x: 280, y: 200 },
      data: {
        label: "Claude 3.5 Sonnet",
        provider: "anthropic", model: "claude-3-5-sonnet-20241022",
        system_prompt: "You are a helpful expert assistant.",
        user_message: "{{prompt}}",
        output_key: "claude_answer",
        temperature: 0.7, max_steps: 10, tools: [],
      },
    },
    {
      id: "_gemini", type: "llm",
      position: { x: 280, y: 400 },
      data: {
        label: "Gemini 1.5 Pro",
        provider: "google", model: "gemini-1.5-pro",
        system_prompt: "You are a helpful expert assistant.",
        user_message: "{{prompt}}",
        output_key: "gemini_answer",
        temperature: 0.7, max_steps: 10, tools: [],
      },
    },
    // ── 집계 LLM ─────────────────────────────────────────────────────────
    {
      id: "_agg", type: "llm",
      position: { x: 580, y: 200 },
      data: {
        label: "집계 & 선택",
        provider: "openai", model: "gpt-4o",
        system_prompt:
          "세 모델의 답변을 비교하여 가장 정확하고 유용한 최종 답변을 작성해주세요.",
        user_message:
          "원본 질문: {{prompt}}\n\n" +
          "GPT-4o 답변:\n{{gpt4_answer}}\n\n" +
          "Claude 답변:\n{{claude_answer}}\n\n" +
          "Gemini 답변:\n{{gemini_answer}}",
        output_key: "final_answer",
        temperature: 0.3, max_steps: 5, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 880, y: 200 },
      data: { label: "Output", output_key: "final_answer" },
    },
  ],
  edges: [
    // Input → 3 LLMs (병렬)
    { id: "_e1", source: "_in",     target: "_gpt4" },
    { id: "_e2", source: "_in",     target: "_claude" },
    { id: "_e3", source: "_in",     target: "_gemini" },
    // 3 LLMs → Aggregator
    { id: "_e4", source: "_gpt4",   target: "_agg" },
    { id: "_e5", source: "_claude", target: "_agg" },
    { id: "_e6", source: "_gemini", target: "_agg" },
    // Aggregator → Output
    { id: "_e7", source: "_agg",    target: "_out" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. 인간 검토 루프
// ─────────────────────────────────────────────────────────────────────────────
const humanReviewLoop: WorkflowTemplate = {
  id: "human-review",
  name: "인간 검토 루프",
  emoji: "🔄",
  description: "LLM 초안 → 인간 승인 → LLM 최종 작성",
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 150 },
      data: { label: "Input", fields: [{ key: "topic", type: "string" }] },
    },
    {
      id: "_draft", type: "llm",
      position: { x: 280, y: 150 },
      data: {
        label: "초안 작성",
        provider: "openai", model: "gpt-4o",
        system_prompt: "주어진 주제에 대해 초안을 작성하세요.",
        user_message: "주제: {{topic}}",
        output_key: "draft",
        temperature: 0.8, max_steps: 10, tools: [],
      },
    },
    {
      id: "_human", type: "human",
      position: { x: 560, y: 150 },
      data: {
        label: "Human Review",
        question: "아래 초안을 검토하고 승인 또는 거부해주세요.\n\n{{draft}}",
        timeout_minutes: 60,
      },
    },
    {
      id: "_final", type: "llm",
      position: { x: 840, y: 150 },
      data: {
        label: "최종 작성",
        provider: "openai", model: "gpt-4o",
        system_prompt: "승인된 초안을 바탕으로 최종 문서를 완성하세요.",
        user_message: "초안:\n{{draft}}\n\n주제: {{topic}}",
        output_key: "final_doc",
        temperature: 0.5, max_steps: 10, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 1120, y: 150 },
      data: { label: "Output", output_key: "final_doc" },
    },
  ],
  edges: [
    { id: "_e1", source: "_in",    target: "_draft" },
    { id: "_e2", source: "_draft", target: "_human" },
    { id: "_e3", source: "_human", target: "_final" },
    { id: "_e4", source: "_final", target: "_out" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. 조건 분기 라우터
// ─────────────────────────────────────────────────────────────────────────────
const conditionalRouter: WorkflowTemplate = {
  id: "conditional-router",
  name: "조건 분기 라우터",
  emoji: "🔀",
  description: "LLM 분류 → 조건 분기 → 전문 LLM 처리",
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 200 },
      data: { label: "Input", fields: [{ key: "question", type: "text" }] },
    },
    {
      id: "_classify", type: "llm",
      position: { x: 280, y: 200 },
      data: {
        label: "분류기",
        provider: "openai", model: "gpt-4o-mini",
        system_prompt:
          '질문이 기술적(technical)인지 일반적(general)인지 판단하여 JSON으로 반환하세요.\n응답 형식: {"is_technical": true/false}',
        user_message: "{{question}}",
        output_key: "classification",
        temperature: 0.1, max_steps: 3, tools: [],
      },
    },
    {
      id: "_branch", type: "branch",
      position: { x: 560, y: 200 },
      data: {
        label: "기술 여부",
        condition: "context.classification?.is_technical === true",
        true_targets: [], false_targets: [],
      },
    },
    {
      id: "_tech", type: "llm",
      position: { x: 840, y: 60 },
      data: {
        label: "기술 전문가",
        provider: "openai", model: "gpt-4o",
        system_prompt: "당신은 기술 전문가입니다. 정확하고 상세한 기술적 답변을 제공하세요.",
        user_message: "{{question}}",
        output_key: "answer",
        temperature: 0.3, max_steps: 10, tools: [],
      },
    },
    {
      id: "_general", type: "llm",
      position: { x: 840, y: 340 },
      data: {
        label: "일반 상담사",
        provider: "anthropic", model: "claude-3-5-sonnet-20241022",
        system_prompt: "당신은 친절한 상담사입니다. 쉽고 친근하게 답변해주세요.",
        user_message: "{{question}}",
        output_key: "answer",
        temperature: 0.7, max_steps: 10, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 1120, y: 200 },
      data: { label: "Output", output_key: "answer" },
    },
  ],
  edges: [
    { id: "_e1", source: "_in",       target: "_classify" },
    { id: "_e2", source: "_classify", target: "_branch" },
    { id: "_e3", source: "_branch",   target: "_tech",    sourceHandle: "true" },
    { id: "_e4", source: "_branch",   target: "_general", sourceHandle: "false" },
    { id: "_e5", source: "_tech",     target: "_out" },
    { id: "_e6", source: "_general",  target: "_out" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. RAG 파이프라인
// ─────────────────────────────────────────────────────────────────────────────
const ragPipeline: WorkflowTemplate = {
  id: "rag-pipeline",
  name: "RAG 파이프라인",
  emoji: "📚",
  description: "지식 검색 → 컨텍스트 주입 → LLM 답변",
  nodes: [
    {
      id: "_in", type: "input",
      position: { x: 0, y: 100 },
      data: { label: "Input", fields: [{ key: "question", type: "text" }] },
    },
    {
      id: "_rag", type: "tool",
      position: { x: 280, y: 100 },
      data: {
        label: "Knowledge Search",
        tool_name: "knowledge_search",
        args: { query: "{{question}}", top_k: 5 },
        output_key: "context",
      },
    },
    {
      id: "_llm", type: "llm",
      position: { x: 560, y: 100 },
      data: {
        label: "RAG LLM",
        provider: "openai", model: "gpt-4o",
        system_prompt:
          "아래 컨텍스트를 바탕으로 질문에 정확하게 답변하세요. 컨텍스트에 없는 내용은 모른다고 말하세요.",
        user_message: "컨텍스트:\n{{context}}\n\n질문: {{question}}",
        output_key: "answer",
        temperature: 0.2, max_steps: 5, tools: [],
      },
    },
    {
      id: "_out", type: "output",
      position: { x: 840, y: 100 },
      data: { label: "Output", output_key: "answer" },
    },
  ],
  edges: [
    { id: "_e1", source: "_in",  target: "_rag" },
    { id: "_e2", source: "_rag", target: "_llm" },
    { id: "_e3", source: "_llm", target: "_out" },
  ],
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  basicChatbot,
  webResearch,
  multiModelHarness,
  humanReviewLoop,
  conditionalRouter,
  ragPipeline,
];
