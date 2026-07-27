import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

export function FolderInlineBranchDrawer({
  children,
  fullWidth = false,
  path,
  scopeRef,
}: {
  children: ReactNode
  fullWidth?: boolean
  path: string
  scopeRef: RefObject<HTMLElement | null>
}) {
  const [target, setTarget] = useState<HTMLElement>()
  const [fullWidthStyle, setFullWidthStyle] = useState<CSSProperties>()
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
      if (scope && targetRef.current && scope.contains(targetRef.current)) return
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

  useLayoutEffect(() => {
    if (!fullWidth || !target) {
      setFullWidthStyle(undefined)
      return
    }
    const scope = scopeRef.current
    if (!scope) return
    const updateGeometry = () => {
      const scopeRect = scope.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      setFullWidthStyle({
        marginLeft: `${Math.round(scopeRect.left - targetRect.left)}px`,
        width: `${Math.round(scope.clientWidth)}px`,
      })
    }
    const observer = new ResizeObserver(updateGeometry)
    observer.observe(scope)
    observer.observe(target)
    updateGeometry()
    return () => observer.disconnect()
  }, [fullWidth, scopeRef, target])

  if (!target) return null
  const content = fullWidth ? <div className="relative z-10 min-w-0" style={fullWidthStyle}>{children}</div> : children
  return createPortal(content, target)
}

function findBranchDrawerTarget(scope: HTMLElement, path: string): HTMLElement | undefined {
  for (const entry of scope.querySelectorAll<HTMLElement>("[data-folder-entry][data-folder-path]")) {
    if (entry.dataset.folderPath === path) return entry.parentElement ?? undefined
  }
  return undefined
}
