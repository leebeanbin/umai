/**
 * /api/image — Image generation proxy
 *
 * Supported providers:
 *   - OpenAI DALL-E 2 / DALL-E 3 (server-side OPENAI_API_KEY)
 *
 * GET  /api/image  → { openai: bool }
 * POST /api/image  → { images: [{ url, revised_prompt }] }
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    openai: !!process.env.OPENAI_API_KEY,
  });
}

export type ImageRequestBody = {
  provider: "openai";
  model: "dall-e-3" | "dall-e-2";
  prompt: string;
  size?: string;
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
  n?: number;
};

export type GeneratedImage = {
  url: string;
  revised_prompt?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json() as ImageRequestBody;
  const { provider, model, prompt, size, quality, style, n } = body;

  if (provider !== "openai") {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json({ error: "__NO_KEY__:openai" }, { status: 401 });
  }

  const requestBody: Record<string, unknown> = {
    model,
    prompt,
    n: n ?? 1,
    size: size ?? "1024x1024",
    response_format: "url",
  };

  // DALL-E 3 exclusive params
  if (model === "dall-e-3") {
    if (quality) requestBody.quality = quality;
    if (style)   requestBody.style   = style;
    requestBody.n = 1; // dall-e-3 only supports n=1
  }

  const upstream = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `OpenAI error ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json() as {
    data: { url: string; revised_prompt?: string }[];
  };

  const images: GeneratedImage[] = data.data.map((item) => ({
    url: item.url,
    revised_prompt: item.revised_prompt,
  }));

  return NextResponse.json({ images });
}
