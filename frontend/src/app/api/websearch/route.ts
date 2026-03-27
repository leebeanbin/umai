import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/api/verifyAuth";
import { resolveSettingsKey } from "@/lib/api/settingsKeyResolver";

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!await verifyToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 500);
  if (!q.trim()) return NextResponse.json({ results: [] });

  const apiKey = await resolveSettingsKey(
    authHeader,
    process.env.TAVILY_API_KEY,
    { section: "connections", field: "tavily_key" },
  );
  if (!apiKey) {
    console.warn("[websearch] Tavily API key not configured (env TAVILY_API_KEY or admin settings → Connections → Tavily)");
    return NextResponse.json({ results: [] });
  }

  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:        apiKey,
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
