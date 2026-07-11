import { useOnClick } from "@ink-tools/ink-mouse"
import { Box, type DOMElement } from "ink"
import { useCallback, useRef, type ReactNode } from "react"

// One terminal event is re-dispatched synchronously after a layout swap. Keep
// the lock shorter than a deliberate second click so normal rapid use remains
// responsive.
const CLICK_GUARD_MS = 32
let lastConsumedClickAt = 0

/** A leaf-only mouse target. Never nest another MouseTarget inside it. */
export function MouseTarget({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const elementRef = useRef<DOMElement>(null)
  const handleClick = useCallback((event: { button: string }) => {
    if (event.button !== "left") return
    const now = Date.now()
    // This guard is shared by every target. A click may cause a synchronous
    // layout replacement (confirmation -> workbench); the release must not be
    // re-hit-tested against the newly revealed control underneath it.
    if (now - lastConsumedClickAt < CLICK_GUARD_MS) return
    lastConsumedClickAt = now
    onClick()
  }, [onClick])
  useOnClick(elementRef, handleClick)
  return <Box ref={elementRef}>{children}</Box>
}
