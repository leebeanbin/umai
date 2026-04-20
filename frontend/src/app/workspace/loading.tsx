export default function WorkspaceLoading() {
  return (
    <div className="flex h-full bg-base overflow-hidden">
      {/* Sidebar skeleton */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col gap-2 p-3">
        <div className="h-8 rounded-lg bg-hover animate-pulse" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 rounded-lg bg-hover animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
      {/* Main skeleton */}
      <div className="flex-1 px-6 py-5 flex flex-col gap-4">
        <div className="h-7 w-48 rounded-lg bg-hover animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-surface border border-border animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
