/**
 * POST /api/image/edit — gpt-image-1 inpainting proxy
 *
 * Accepts multipart FormData:
 *   image    File  PNG, square (1024×1024 recommended)
 *   mask     File  PNG same size; transparent pixels = areas to edit
 *   prompt   string
 *   n        string  "1"–"4"
 *   size     string  "1024x1024" | "1536x1024" | "1024x1536"
 *
 * Returns { images: [{ b64: string }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/api/verifyAuth";
import { resolveSettingsKey } from "@/lib/api/settingsKeyResolver";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!await verifyToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = await resolveSettingsKey(
    authHeader,
    process.env.OPENAI_API_KEY,
    { section: "images", field: "dalle_key" },
    { section: "connections", field: "openai_key" },
  );
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
  fd.append("model",  "gpt-image-1");
  fd.append("n",      n ?? "1");
  fd.append("size",   size ?? "1024x1024");
  fd.append("response_format", "b64_json");

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

  const data = await upstream.json() as { data: { b64_json: string }[] };
  return NextResponse.json({ images: data.data.map((d) => ({ b64: d.b64_json })) });
}
