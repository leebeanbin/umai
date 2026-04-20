"use client";

import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <p className="text-7xl font-black text-accent/30 select-none">404</p>
        <h1 className="mt-2 text-lg font-semibold text-text-primary">페이지를 찾을 수 없습니다</h1>
        <p className="mt-1 text-sm text-text-muted">요청하신 페이지가 존재하지 않거나 이동되었습니다.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => history.back()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm border border-border text-text-secondary hover:bg-hover transition-colors"
        >
          <ArrowLeft size={13} />
          뒤로 가기
        </button>
        <Link
          href="/"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Home size={13} />
          홈으로
        </Link>
      </div>
    </div>
  );
}
