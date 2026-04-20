export default function AdminLoading() {
  return (
    <div className="flex h-full bg-base overflow-hidden">
      {/* Nav skeleton */}
      <div className="w-44 shrink-0 border-r border-border flex flex-col gap-1 p-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-hover animate-pulse" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="flex-1 px-5 py-4 flex flex-col gap-4 max-w-3xl">
        <div className="h-7 w-40 rounded-lg bg-hover animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface border border-border animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-surface border border-border animate-pulse" />
      </div>
    </div>
  );
}
