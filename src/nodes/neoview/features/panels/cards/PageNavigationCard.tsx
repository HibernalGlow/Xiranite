import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReaderPanelContext } from "../registry"

export default function PageNavigationCard({ session, disabled, onGoTo }: ReaderPanelContext) {
  const current = session.frame.anchorPageIndex + 1
  const [pageNumber, setPageNumber] = useState(String(current))
  useEffect(() => setPageNumber(String(current)), [current])

  function commit() {
    const value = Number.parseInt(pageNumber, 10)
    if (Number.isSafeInteger(value) && value >= 1 && value <= session.book.pageCount) void onGoTo(value - 1)
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">阅读进度</span>
        <span className="tabular-nums">{current} / {session.book.pageCount}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${current / session.book.pageCount * 100}%` }} />
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="跳转页码"
          type="number"
          min={1}
          max={session.book.pageCount}
          value={pageNumber}
          onChange={(event) => setPageNumber(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit()
          }}
        />
        <Button type="button" size="sm" disabled={disabled} onClick={commit}>跳转</Button>
      </div>
    </div>
  )
}
