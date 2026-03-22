/**
 * POST /api/ocr
 *
 * Synchronously extracts text from an image using a local Ollama vision model.
 * Falls back to empty string on failure so the caller can degrade gracefully.
 *
 * Body: { image: "data:image/...;base64,...", prompt?: string, model?: string }
 * Response: { text: string }
 */

import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_OCR_MODEL = process.env.OCR_MODEL ?? "llava";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    image?: string;
    prompt?: string;
    model?: string;
  };

  const { image, prompt, model = DEFAULT_OCR_MODEL } = body;
  if (!image) return NextResponse.json({ text: "" });

  // Strip the data URL prefix to get raw base64
  const base64 = image.replace(/^data:[^;]+;base64,/, "");

  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: prompt ?? "Extract all text visible in this image. Return only the extracted text with no extra commentary.",
        images: [base64],
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!r.ok) return NextResponse.json({ text: "" });

    const data = await r.json() as { response?: string };
    return NextResponse.json({ text: (data.response ?? "").trim() });
  } catch {
    return NextResponse.json({ text: "" });
  }
}
