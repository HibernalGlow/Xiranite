import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ContextMenuItemDef {
  /** Item kind. Defaults to "item". */
  type?: "item" | "separator" | "label"
  /** Localized label (already translated by the builder). */
  label?: string
  /** Leading icon node. */
  icon?: ReactNode
  /** Keyboard shortcut hint, e.g. "Ctrl+D". */
  shortcut?: string
  /** Disable the item. */
  disabled?: boolean
  /** Render in destructive color. */
  destructive?: boolean
  /** Click handler. Only for "item" type. */
  onSelect?: () => void
}

export interface ContextMenuContext {
  /** The element carrying the data-context-menu attribute. */
  element: HTMLElement
  /** The original DOM event. */
  event: MouseEvent
  /** Sanitized dataset of the element (without the contextMenu key). */
  data: Record<string, string>
}

type Builder = (ctx: ContextMenuContext) => ContextMenuItemDef[] | null

interface ContextMenuAPI {
  /** Register a builder for a scope. Returns an unregister function. */
  register: (scope: string, builder: Builder) => () => void
  /** Programmatically show a menu at coordinates. */
  show: (x: number, y: number, items: ContextMenuItemDef[]) => void
}

// ──────────────────────────────────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────────────────────────────────

const ContextMenuBuilderContext = createContext<ContextMenuAPI | null>(null)

// ──────────────────────────────────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────────────────────────────────

interface OpenMenu {
  x: number
  y: number
  items: ContextMenuItemDef[]
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const buildersRef = useRef(new Map<string, Builder>())
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null)

  const show = useCallback((x: number, y: number, items: ContextMenuItemDef[]) => {
    if (items.length === 0) return
    setOpenMenu({ x, y, items })
  }, [])

  const register = useCallback((scope: string, builder: Builder) => {
    buildersRef.current.set(scope, builder)
    return () => {
      buildersRef.current.delete(scope)
    }
  }, [])

  // Global contextmenu listener: suppress native menu + collect builder items.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const isEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      // Always suppress native menu for non-editable targets.
      if (!isEditable) e.preventDefault()

      // For editable targets, let the native menu through and skip custom menu.
      if (isEditable) return

      const items: ContextMenuItemDef[] = []
      const seenScopes = new Set<string>()

      for (const el of e.composedPath()) {
        if (!(el instanceof HTMLElement)) continue
        const scope = el.dataset.contextMenu
        if (!scope || seenScopes.has(scope)) continue
        seenScopes.add(scope)
        const builder = buildersRef.current.get(scope)
        if (!builder) continue
        const data: Record<string, string> = {}
        for (const k in el.dataset) {
          if (k === "contextMenu") continue
          data[k] = el.dataset[k] as string
        }
        const built = builder({ element: el, event: e, data })
        if (built && built.length > 0) {
          items.push(...built, { type: "separator" })
        }
      }

      // Drop trailing separators.
      while (items.length > 0 && items[items.length - 1].type === "separator") {
        items.pop()
      }

      if (items.length === 0) return
      setOpenMenu({ x: e.clientX, y: e.clientY, items })
    }
    window.addEventListener("contextmenu", handler)
    return () => window.removeEventListener("contextmenu", handler)
  }, [])

  const api = useMemo<ContextMenuAPI>(() => ({ register, show }), [register, show])

  return (
    <ContextMenuBuilderContext.Provider value={api}>
      {children}
      {openMenu && (
        <MenuRenderer
          coords={{ x: openMenu.x, y: openMenu.y }}
          items={openMenu.items}
          onClose={() => setOpenMenu(null)}
        />
      )}
    </ContextMenuBuilderContext.Provider>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Hook: register a builder for a scope
// ──────────────────────────────────────────────────────────────────────────

export function useContextMenuBuilder(scope: string, builder: Builder) {
  const ctx = useContext(ContextMenuBuilderContext)
  const builderRef = useRef(builder)
  builderRef.current = builder
  useEffect(() => {
    if (!ctx) return
    return ctx.register(scope, (args) => builderRef.current(args))
  }, [ctx, scope])
}

// ──────────────────────────────────────────────────────────────────────────
// Hook: imperative access (for programmatic show)
// ──────────────────────────────────────────────────────────────────────────

export function useContextMenu() {
  return useContext(ContextMenuBuilderContext)
}

// ──────────────────────────────────────────────────────────────────────────
// Menu renderer
// ──────────────────────────────────────────────────────────────────────────

function MenuRenderer({
  coords,
  items,
  onClose,
}: {
  coords: { x: number; y: number }
  items: ContextMenuItemDef[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pos, setPos] = useState(coords)

  // Adjust position to keep menu inside viewport.
  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const pad = 4
    setPos({
      x: Math.min(coords.x, window.innerWidth - rect.width - pad),
      y: Math.min(coords.y, window.innerHeight - rect.height - pad),
    })
  }, [coords])

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => nextSelectable(items, i, 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => nextSelectable(items, i, -1))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const item = items[activeIndex]
        if (item && item.type !== "separator" && item.type !== "label" && !item.disabled) {
          item.onSelect?.()
          onClose()
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [items, activeIndex, onClose])

  // Click outside to close.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", handler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener("mousedown", handler)
    }
  }, [onClose])

  // Close on blur / scroll.
  useEffect(() => {
    const onScroll = () => onClose()
    window.addEventListener("blur", onClose)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("blur", onClose)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className={cn(
        "z-50 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      )}
      style={{ position: "fixed", left: pos.x, top: pos.y }}
      onMouseLeave={() => setActiveIndex(-1)}
    >
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <div key={i} className="-mx-1 my-1 h-px bg-border" />
        }
        if (item.type === "label") {
          return (
            <div
              key={i}
              className="px-2 py-1.5 text-xs text-muted-foreground select-none"
            >
              {item.label}
            </div>
          )
        }
        const active = i === activeIndex
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-variant={item.destructive ? "destructive" : undefined}
            className={cn(
              "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none outline-none",
              "focus:bg-accent focus:text-accent-foreground",
              "data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive",
              !item.disabled && active && "bg-accent text-accent-foreground",
              item.disabled && "opacity-50 pointer-events-none",
            )}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => {
              if (item.disabled) return
              item.onSelect?.()
              onClose()
            }}
          >
            {item.icon && (
              <span className="pointer-events-none shrink-0 size-4 text-muted-foreground">
                {item.icon}
              </span>
            )}
            <span className="flex-1 text-left truncate">{item.label}</span>
            {item.shortcut && (
              <span className="ml-auto text-xs tracking-widest text-muted-foreground">
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

function nextSelectable(
  items: ContextMenuItemDef[],
  from: number,
  dir: 1 | -1,
): number {
  const n = items.length
  for (let step = 1; step <= n; step++) {
    const idx = (from + dir * step + n) % n
    const it = items[idx]
    if (it && it.type !== "separator" && it.type !== "label" && !it.disabled) {
      return idx
    }
  }
  return from
}
