import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/api/verifyAuth";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? "";

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export async function GET(req: NextRequest) {
  if (!await verifyToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 500);
  if (!q.trim()) return NextResponse.json({ results: [] });

  if (!TAVILY_API_KEY) {
    // Graceful fallback: return empty so web search silently no-ops
    console.warn("[websearch] TAVILY_API_KEY not set");
    return NextResponse.json({ results: [] });
  }

  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:        TAVILY_API_KEY,
        query:          q,
        search_depth:   "basic",
        max_results:    6,
        include_answer: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) return NextResponse.json({ results: [] });

    const data = await r.json() as {
      results?: { title?: string; content?: string; url?: string; score?: number }[];
    };

    const results: SearchResult[] = (data.results ?? [])
      .slice(0, 6)
      .map((item) => ({
        title:   item.title   ?? "",
        snippet: item.content ?? "",
        url:     item.url     ?? "",
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
