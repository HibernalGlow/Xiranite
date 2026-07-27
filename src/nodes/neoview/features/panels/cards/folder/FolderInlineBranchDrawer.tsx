import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

export function FolderInlineBranchDrawer({
  children,
  path,
  scopeRef,
}: {
  children: ReactNode
  path: string
  scopeRef: RefObject<HTMLElement | null>
}) {
  const [target, setTarget] = useState<HTMLElement>()
  const targetRef = useRef<HTMLElement>()

  useLayoutEffect(() => {
    let frame = 0
    let observer: MutationObserver | undefined
    let disposed = false
    targetRef.current = undefined
    setTarget(undefined)

    const updateTarget = () => {
      if (disposed) return
      const scope = scopeRef.current
      if (scope && targetRef.current && scope.contains(targetRef.current) && targetContainsBranch(targetRef.current, path)) return
      const next = scope ? findBranchDrawerTarget(scope, path) : undefined
      targetRef.current = next
      setTarget((current) => current === next ? current : next)
      if (!scope) frame = requestAnimationFrame(updateTarget)
    }

    updateTarget()
    const scope = scopeRef.current
    if (scope) {
      observer = new MutationObserver(updateTarget)
      observer.observe(scope, { childList: true, subtree: true })
    }

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [path, scopeRef])

  if (!target) return null
  return createPortal(children, target)
}

function findBranchDrawerTarget(scope: HTMLElement, path: string): HTMLElement | undefined {
  for (const entry of scope.querySelectorAll<HTMLElement>("[data-folder-entry][data-folder-path]")) {
    if (entry.dataset.folderPath === path) return entry.parentElement ?? undefined
  }
  return undefined
}

function targetContainsBranch(target: HTMLElement, path: string): boolean {
  return Array.from(target.querySelectorAll<HTMLElement>("[data-folder-entry][data-folder-path]")).some((entry) => entry.dataset.folderPath === path)
}
