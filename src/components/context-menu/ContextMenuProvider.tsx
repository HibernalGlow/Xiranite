import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu"

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ContextMenuItemDef {
  /** Item kind. Defaults to "item". */
  type?: "item" | "separator" | "label" | "checkbox" | "radio"
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
  /** Checkbox state (for "checkbox" type). */
  checked?: boolean
  /** Radio value (for "radio" type). */
  value?: string
  /** Radio group name (for "radio" type, items with same group share selection). */
  radioGroup?: string
  /** Current radio group value (for "radio" type, on the group's first item). */
  radioValue?: string
  /** Callback when radio changes. */
  onRadioChange?: (value: string) => void
  /** Submenu children (implies a submenu trigger). */
  children?: ContextMenuItemDef[]
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
        <MenuController
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
// Menu controller: drives the Radix DropdownMenu in controlled mode.
// Uses an invisible 1x1 anchor positioned at the click coordinates.
// ──────────────────────────────────────────────────────────────────────────

function MenuController({
  coords,
  items,
  onClose,
}: {
  coords: { x: number; y: number }
  items: ContextMenuItemDef[]
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const anchorRef = useRef<HTMLSpanElement>(null)

  // Position the invisible anchor at the click point.
  useEffect(() => {
    if (anchorRef.current) {
      anchorRef.current.style.left = `${coords.x}px`
      anchorRef.current.style.top = `${coords.y}px`
    }
  }, [coords])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onClose()
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          ref={anchorRef}
          aria-hidden
          style={{
            position: "fixed",
            left: coords.x,
            top: coords.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
            opacity: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        alignOffset={0}
        className="min-w-[10rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <MenuItems items={items} onDone={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Recursive item renderer
// ──────────────────────────────────────────────────────────────────────────

function MenuItems({
  items,
  onDone,
}: {
  items: ContextMenuItemDef[]
  onDone: () => void
}) {
  // Collect radio groups: first item with radioGroup defines the group's value + handler.
  const radioGroups = useMemo(() => {
    const map = new Map<string, { value: string; onRadioChange?: (v: string) => void }>()
    for (const it of items) {
      if (it.type === "radio" && it.radioGroup && !map.has(it.radioGroup)) {
        map.set(it.radioGroup, {
          value: it.radioValue ?? "",
          onRadioChange: it.onRadioChange,
        })
      }
    }
    return map
  }, [items])

  return (
    <>
      {items.map((item, i) => {
        if (item.type === "separator") {
          return <DropdownMenuSeparator key={i} />
        }
        if (item.type === "label") {
          return <DropdownMenuLabel key={i}>{item.label}</DropdownMenuLabel>
        }
        // Submenu
        if (item.children && item.children.length > 0) {
          return (
            <DropdownMenuSub key={i}>
              <DropdownMenuSubTrigger>
                {item.icon && <span className="mr-2 size-4">{item.icon}</span>}
                <span>{item.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <MenuItems items={item.children} onDone={onDone} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }
        if (item.type === "checkbox") {
          return (
            <DropdownMenuCheckboxItem
              key={i}
              checked={item.checked}
              disabled={item.disabled}
              onSelect={(e) => {
                if (item.disabled) {
                  e.preventDefault()
                  return
                }
                item.onSelect?.()
                onDone()
              }}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          )
        }
        if (item.type === "radio" && item.radioGroup) {
          const group = radioGroups.get(item.radioGroup)
          return (
            <DropdownMenuRadioGroup
              key={`group-${item.radioGroup}-${i}`}
              value={group?.value}
              onValueChange={(v) => group?.onRadioChange?.(v)}
            >
              <DropdownMenuRadioItem
                value={item.value ?? ""}
                disabled={item.disabled}
                onSelect={(e) => {
                  if (item.disabled) {
                    e.preventDefault()
                    return
                  }
                  item.onSelect?.()
                  onDone()
                }}
              >
                {item.label}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          )
        }
        // Default item
        return (
          <DropdownMenuItem
            key={i}
            disabled={item.disabled}
            variant={item.destructive ? "destructive" : "default"}
            onSelect={(e) => {
              if (item.disabled) {
                e.preventDefault()
                return
              }
              item.onSelect?.()
              onDone()
            }}
          >
            {item.icon && <span className="mr-2 size-4 text-muted-foreground">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}
