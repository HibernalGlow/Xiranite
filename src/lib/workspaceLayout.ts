import type { ComponentInstance, ComputedLayout, LayoutMode } from "@/types/workspace"

const GAP = 16
const PAD = 16
const HEADER_H = 40
const STRIP_W = 220
const MIN_PANEL_W = 320
const MIN_PANEL_H = 240

export interface LayoutContext {
  components: ComponentInstance[]
  mode: LayoutMode
  focusedId: string | null
  fullscreenId: string | null
  W: number
  H: number
}

/**
 * Pure layout engine — given workspace state + canvas size, returns the target
 * geometry for every component. The same component instance is only ever
 * repositioned (never remounted), so internal state survives every layout
 * morph. Inspired by spatial-canvas's computeLayout, adapted to Xiranite.
 */
export function computeLayout({
  components,
  mode,
  focusedId,
  fullscreenId,
  W,
  H,
}: LayoutContext): Record<string, ComputedLayout> {
  const out: Record<string, ComputedLayout> = {}
  const innerW = Math.max(MIN_PANEL_W, W - PAD * 2)
  const innerH = Math.max(MIN_PANEL_H, H - PAD * 2)
  const collapsedH = HEADER_H

  const base = (
    comp: ComponentInstance,
    state: ComputedLayout["state"],
    r: { x: number; y: number; w: number; h: number },
    extra?: Partial<ComputedLayout>,
  ): ComputedLayout => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    scale: 1,
    opacity: 1,
    z: comp.z ?? 1,
    state,
    interactive: true,
    ...extra,
  })

  // 1. Fullscreen wins over everything — keep others mounted but parked off-screen.
  if (fullscreenId) {
    components.forEach(comp => {
      if (comp.id === fullscreenId) {
        out[comp.id] = base(comp, "fullscreen", { x: PAD, y: PAD, w: innerW, h: innerH }, { z: 1000 })
      } else {
        out[comp.id] = base(
          comp,
          "docked",
          { x: PAD, y: PAD, w: 400, h: 300 },
          { opacity: 0, scale: 0.9, interactive: false, z: 0 },
        )
      }
    })
    return out
  }

  // 2. Free layout: use each component's stored position/size with focus dimming.
  if (mode === "free") {
    components.forEach(comp => {
      const px = comp.position?.x ?? PAD
      const py = comp.position?.y ?? PAD
      const pw = comp.size?.w ?? 340
      const ph = comp.collapsed ? collapsedH : comp.size?.h ?? 280
      const focused = focusedId === comp.id
      out[comp.id] = base(
        comp,
        comp.collapsed ? "compact" : "floating",
        { x: px, y: py, w: pw, h: ph },
        {
          opacity: focusedId && !focused ? 0.5 : 1,
          z: focused ? 900 : comp.z ?? 1,
        },
      )
    })
    return out
  }

  // 3. Grid: auto-tile into 1/2/3 columns based on count.
  if (mode === "grid") {
    const n = components.length || 1
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const cw = (innerW - GAP * (cols - 1)) / cols
    const ch = (innerH - GAP * (rows - 1)) / rows
    components.forEach((comp, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      const collapsed = comp.collapsed
      out[comp.id] = base(comp, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + r * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      })
    })
    return out
  }

  // 4. Stack: cascading overlap deck of cards.
  if (mode === "stack") {
    const cardW = Math.min(620, innerW - 80)
    const cardH = Math.min(440, innerH - 120)
    const step = 32
    components.forEach((comp, i) => {
      const collapsed = comp.collapsed
      out[comp.id] = base(
        comp,
        collapsed ? "compact" : "docked",
        { x: PAD + i * step, y: PAD + i * step, w: cardW, h: collapsed ? collapsedH : cardH },
        { z: i + 1 },
      )
    })
    return out
  }

  // 5. Split: two columns, items distributed left/right.
  if (mode === "split") {
    const cols = 2
    const cw = (innerW - GAP) / cols
    components.forEach((comp, i) => {
      const c = i % cols
      const col = components.filter((_, j) => j % cols === c)
      const idxInCol = col.findIndex(x => x.id === comp.id)
      const ch = (innerH - GAP * (col.length - 1)) / col.length
      const collapsed = comp.collapsed
      out[comp.id] = base(comp, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + idxInCol * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      })
    })
    return out
  }

  // 6. Focus: one hero panel, the rest as a thumbnail strip on the right.
  const heroId = focusedId ?? components[0]?.id ?? null
  const others = components.filter(comp => comp.id !== heroId)
  const stripW = others.length ? STRIP_W : 0
  const heroW = innerW - (stripW ? stripW + GAP : 0)

  components.forEach(comp => {
    if (comp.id === heroId) {
      out[comp.id] = base(
        comp,
        "focused",
        { x: PAD, y: PAD, w: heroW, h: innerH },
        { z: 500 },
      )
    }
  })

  const thumbH = others.length ? (innerH - GAP * (others.length - 1)) / others.length : 0
  others.forEach((comp, i) => {
    out[comp.id] = base(
      comp,
      "compact",
      { x: PAD + heroW + GAP, y: PAD + i * (thumbH + GAP), w: stripW, h: thumbH },
      { opacity: 0.92, z: comp.z ?? 1 },
    )
  })

  return out
}
