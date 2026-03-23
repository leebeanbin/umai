import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Proxy /api/* → backend server
  // INTERNAL_API_URL is a server-side-only env var (not exposed to browser)
  // dev:  set in .env.local          (INTERNAL_API_URL=http://localhost:8001)
  // prod: set as Docker ARG/ENV      (INTERNAL_API_URL=http://umai-backend:8000)
  async rewrites() {
    const backendUrl = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },

  async headers() {
    return [
      // ── 보안 헤더 (모든 경로) ─────────────────────────────────────────────
      {
        source: "/(.*)",
        headers: [
          // Clickjacking 방지
          { key: "X-Frame-Options", value: "DENY" },
          // MIME 스니핑 방지
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer 최소화
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 권한 API 최소화
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // XSS 필터 (레거시 브라우저)
          { key: "X-XSS-Protection", value: "1; mode=block" },
          // Content-Security-Policy
          // sha256 해시는 layout.tsx의 THEME_SCRIPT 인라인 스크립트 허용용
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js 인라인 스크립트(테마) + 청크 스크립트 허용
              "script-src 'self' 'sha256-LF5M/cDVBp3pRxj7LvvnHVGyozxUrS/2arCIwarejmo='",
              // Tailwind 인라인 스타일 허용
              "style-src 'self' 'unsafe-inline'",
              // 이미지: self + data URI (base64 업로드 미리보기) + HTTPS
              "img-src 'self' data: https:",
              // 폰트: Google Fonts
              "font-src 'self' https://fonts.gstatic.com",
              // API 연결: same-origin + OAuth providers
              "connect-src 'self' https://accounts.google.com https://github.com",
              // iframe 완전 차단
              "frame-ancestors 'none'",
              // 폼 same-origin 전송만 허용
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // ── 정적 자산 장기 캐시 (Next.js _next/static은 content-hash 포함) ────
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // ── favicon, 이미지 등 public 자산 캐시 ─────────────────────────────
      {
        source: "/(favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?))",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
