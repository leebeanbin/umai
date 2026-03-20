/**
 * POST /api/image/edit — DALL-E 2 inpainting proxy
 *
 * Accepts multipart FormData:
 *   image    File  PNG, < 4MB, square
 *   mask     File  PNG same size; transparent pixels = areas to edit
 *   prompt   string
 *   n        string  "1"–"4"
 *   size     string  "256x256" | "512x512" | "1024x1024"
 *
 * Returns { images: [{ url: string }] }
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json({ error: "__NO_KEY__:openai" }, { status: 401 });
  }

  const form = await req.formData();
  const image  = form.get("image")  as File | null;
  const mask   = form.get("mask")   as File | null;
  const prompt = form.get("prompt") as string | null;
  const n      = form.get("n")      as string | null;
  const size   = form.get("size")   as string | null;

  if (!image || !mask || !prompt) {
    return NextResponse.json({ error: "image, mask, and prompt are required" }, { status: 400 });
  }

  const fd = new FormData();
  fd.append("image",  image,  "image.png");
  fd.append("mask",   mask,   "mask.png");
  fd.append("prompt", prompt);
  fd.append("model",  "dall-e-2");
  fd.append("n",      n ?? "2");
  fd.append("size",   size ?? "1024x1024");
  fd.append("response_format", "url");

  const upstream = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({})) as Record<string, Record<string, string>>;
    return NextResponse.json(
      { error: err?.error?.message ?? `OpenAI error ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json() as { data: { url: string }[] };
  return NextResponse.json({ images: data.data.map((d) => ({ url: d.url })) });
}
