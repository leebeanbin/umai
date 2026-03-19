import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth은 클라이언트 AuthModal이 처리하므로 proxy는 모든 요청을 통과시킵니다.
 * 추후 API 라우트별 서버-사이드 보호가 필요하면 여기에 추가합니다.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
