export function ReaderCardEmptyState({ children = "打开书本后显示内容" }: { children?: string }) {
  return (
    <div className="grid min-h-16 place-items-center px-3 py-4 text-center text-[11px] text-muted-foreground" data-reader-card-empty="true">
      {children}
    </div>
  )
}
