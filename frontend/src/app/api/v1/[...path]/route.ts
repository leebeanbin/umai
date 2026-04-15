/**
 * /api/v1/[...path] — Transparent server-side proxy to the FastAPI backend.
 *
 * Replaces the next.config.ts rewrite rule for /api/v1/** routes.
 * Route Handlers run reliably in both Turbopack dev and standalone production,
 * whereas external rewrites in Turbopack dev mode issue 307 redirects to the
 * backend URL — which violates CSP and breaks auth header forwarding.
 *
 * We use redirect:"follow" on the server side (no CSP restrictions here) so
 * FastAPI's trailing-slash 308 redirects are resolved transparently without
 * the client ever seeing a redirect to http://localhost:8000.
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname;
  const search   = req.nextUrl.search;
  const target   = `${BACKEND}${pathname}${search}`;

  // Forward all headers except "host" (which must reflect the backend host)
  const headers = new Headers(req.headers);
  headers.delete("host");

  const hasBody = !["GET", "HEAD"].includes(req.method);

  // Buffer body upfront so it can be resent if the server issues a redirect.
  // All our API payloads are small JSON — buffering is safe.
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const upstream = await fetch(target, {
    method:  req.method,
    headers,
    body,
    // Follow backend redirects (e.g. FastAPI trailing-slash 308) server-side.
    // The client must never receive a redirect pointing at http://localhost:8000
    // because that URL is not reachable from the browser (CSP + CORS).
    redirect: "follow",
    cache:    "no-store",
  });

  // Strip hop-by-hop headers that must not be forwarded to the client
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(upstream.body, {
    status:  upstream.status,
    headers: responseHeaders,
  });
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;
export const HEAD    = proxy;
export const OPTIONS = proxy;

// Opt out of Next.js response caching — all /api/v1/* must be fresh
export const dynamic = "force-dynamic";
