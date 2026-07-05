import type { ComputedLayout, LayoutMode, Panel, PanelState } from "./types";

const GAP = 20;
const PAD = 20;
const HEADER_H = 44;

interface Ctx {
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  W: number;
  H: number;
}

/**
 * Pure layout engine: given workspace state + canvas size, returns the target
 * geometry for every panel. The same panel instance is only ever repositioned
 * (never remounted), so internal component state survives every layout change.
 */
export function computeLayout({
  panels,
  mode,
  focusedId,
  fullscreenId,
  W,
  H,
}: Ctx): Record<string, ComputedLayout> {
  const out: Record<string, ComputedLayout> = {};
  const innerW = Math.max(320, W - PAD * 2);
  const innerH = Math.max(240, H - PAD * 2);

  const base = (p: Panel, state: PanelState, r: { x: number; y: number; w: number; h: number }, extra?: Partial<ComputedLayout>): ComputedLayout => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    scale: 1,
    opacity: 1,
    z: p.z,
    state,
    interactive: true,
    ...extra,
  });

  // 1. Fullscreen wins over everything.
  if (fullscreenId) {
    panels.forEach((p) => {
      if (p.id === fullscreenId) {
        out[p.id] = base(p, "fullscreen", { x: PAD, y: PAD, w: innerW, h: innerH }, { z: 1000 });
      } else {
        // keep mounted but parked off the visible field
        out[p.id] = base(p, "docked", { x: PAD, y: PAD, w: 400, h: 300 }, {
          opacity: 0,
          scale: 0.9,
          interactive: false,
          z: 0,
        });
      }
    });
    return out;
  }

  const collapsedH = HEADER_H;

  if (mode === "free") {
    panels.forEach((p) => {
      const h = p.collapsed ? collapsedH : p.free.h;
      const focused = focusedId === p.id;
      out[p.id] = base(p, p.collapsed ? "compact" : "floating", { x: p.free.x, y: p.free.y, w: p.free.w, h }, {
        opacity: focusedId && !focused ? 0.5 : 1,
        z: focused ? 900 : p.z,
      });
    });
    return out;
  }

  if (mode === "grid") {
    const n = panels.length || 1;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cw = (innerW - GAP * (cols - 1)) / cols;
    const ch = (innerH - GAP * (rows - 1)) / rows;
    panels.forEach((p, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + r * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      });
    });
    return out;
  }

  if (mode === "stack") {
    // Cascading overlap stack — like a deck of cards.
    const cardW = Math.min(560, innerW - 80);
    const cardH = Math.min(420, innerH - 120);
    const step = 34;
    panels.forEach((p, i) => {
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + i * step,
        y: PAD + i * step,
        w: cardW,
        h: collapsed ? collapsedH : cardH,
      }, { z: i + 1 });
    });
    return out;
  }

  if (mode === "split") {
    const cols = 2;
    const cw = (innerW - GAP) / cols;
    panels.forEach((p, i) => {
      const c = i % cols;
      const col = panels.filter((_, j) => j % cols === c);
      const idxInCol = col.findIndex((x) => x.id === p.id);
      const ch = (innerH - GAP * (col.length - 1)) / col.length;
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + idxInCol * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      });
    });
    return out;
  }

  // focus mode: one hero panel, the rest as a strip of thumbnails on the right.
  const heroId = focusedId ?? panels[0]?.id ?? null;
  const others = panels.filter((p) => p.id !== heroId);
  const stripW = others.length ? 220 : 0;
  const heroW = innerW - (stripW ? stripW + GAP : 0);
  panels.forEach((p) => {
    if (p.id === heroId) {
      out[p.id] = base(p, "focused", { x: PAD, y: PAD, w: heroW, h: innerH }, { z: 500 });
    }
  });
  const thumbH = others.length ? (innerH - GAP * (others.length - 1)) / others.length : 0;
  others.forEach((p, i) => {
    out[p.id] = base(p, "compact", {
      x: PAD + heroW + GAP,
      y: PAD + i * (thumbH + GAP),
      w: stripW,
      h: thumbH,
    }, { opacity: 0.85 });
  });
  return out;
}
