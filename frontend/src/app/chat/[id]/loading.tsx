export default function ChatLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Message skeleton */}
      <div className="flex-1 overflow-hidden px-4 py-6 flex flex-col gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={`flex gap-3 ${i % 2 === 1 ? "flex-row-reverse" : ""}`}
          >
            <div className="size-7 rounded-full bg-hover animate-pulse shrink-0" />
            <div className="flex flex-col gap-1.5 max-w-sm">
              <div
                className="h-4 rounded-lg bg-hover animate-pulse"
                style={{ width: `${180 + i * 30}px` }}
              />
              <div
                className="h-4 rounded-lg bg-hover animate-pulse"
                style={{ width: `${120 + i * 20}px` }}
              />
            </div>
          </div>
        ))}
      </div>
      {/* Input skeleton */}
      <div className="px-4 pb-4">
        <div className="h-12 rounded-2xl bg-surface border border-border animate-pulse" />
      </div>
    </div>
  );
}
