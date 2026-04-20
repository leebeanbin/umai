"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle size={20} />
        <span className="text-sm font-medium">오류가 발생했습니다</span>
      </div>
      {error.digest && (
        <p className="text-xs text-text-muted font-mono">Error ID: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm bg-accent text-white hover:bg-accent-hover transition-colors"
      >
        <RefreshCw size={13} />
        다시 시도
      </button>
    </div>
  );
}
