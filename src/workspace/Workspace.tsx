import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "./store";
import { computeLayout } from "./layout";
import { Panel } from "./Panel";
import { REGISTRY } from "./registry";
import { TabBar } from "./TabBar";
import { ThemeMenu } from "./ThemeMenu";
import { CommandPalette } from "./CommandPalette";
import type { LayoutMode } from "./types";

const MODES: { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: "free", label: "FREE", hint: "drag anywhere" },
  { mode: "grid", label: "GRID", hint: "auto tile" },
  { mode: "stack", label: "STACK", hint: "cascade" },
  { mode: "split", label: "SPLIT", hint: "two columns" },
  { mode: "focus", label: "FOCUS", hint: "hero + strip" },
];

export function Workspace() {
  const ws = useWorkspace();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [adderOpen, setAdderOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        ws.setFullscreen(null);
        setAdderOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  // Switching to FREE adopts the current on-screen geometry so panels don't
  // jump or resize — an Arc-like smooth handoff between layout modes.
  const switchMode = (mode: LayoutMode) => {
    if (mode === "free") {
      const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
      ws.panels.forEach((p) => {
        const l = layouts[p.id];
        if (l) rects[p.id] = { x: l.x, y: l.y, w: l.w, h: l.h };
      });
      ws.enterFree(rects);
    } else {
      ws.setMode(mode);
    }
  };


  const layouts = computeLayout({
    panels: ws.panels,
    mode: ws.mode,
    focusedId: ws.focusedId,
    fullscreenId: ws.fullscreenId,
    W: size.w,
    H: size.h,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* top bar */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-[image:var(--gradient-acid)] font-mono text-sm font-bold text-acid-foreground">
            ▚
          </span>
          <h1 className="font-mono text-sm font-bold tracking-[0.25em] text-foreground">GRIDLOCK</h1>
        </div>

        {/* layout switcher */}
        <div className="ml-2 flex items-center gap-1 rounded-md border border-border bg-background/60 p-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              onClick={() => switchMode(m.mode)}
              title={m.hint}
              className={`rounded-[4px] px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors ${
                ws.mode === m.mode && !ws.fullscreenId
                  ? "bg-[image:var(--gradient-acid)] text-acid-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
            {ws.panels.length} components · state persists across layouts
          </span>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-sm border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-acid/60 hover:text-foreground"
          >
            <span>⌘K</span>
            <span className="hidden sm:inline">command</span>
          </button>
          <ThemeMenu />

          <button
            onClick={() => setAdderOpen((v) => !v)}
            className="rounded-sm border border-acid/60 bg-acid/10 px-3 py-1.5 font-mono text-xs font-semibold tracking-wider text-acid transition-colors hover:bg-acid hover:text-acid-foreground"
          >
            + INSERT
          </button>
        </div>
      </header>

      <TabBar />


      {/* canvas */}
      <div className="relative flex-1 overflow-hidden bg-scan" ref={canvasRef}>
        {ws.panels.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-acid-gradient font-mono text-2xl font-bold">EMPTY WORKSPACE</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">insert a component to begin</p>
            </div>
          </div>
        )}

        {ws.panels.map((p) => (
          <Panel
            key={p.id}
            id={p.id}
            kind={p.kind}
            title={p.title}
            layout={layouts[p.id]}
            canvasRef={canvasRef}
          />
        ))}

        {/* fullscreen exit hint */}
        <AnimatePresence>
          {ws.fullscreenId && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={() => ws.setFullscreen(null)}
              className="absolute bottom-4 left-1/2 z-[1001] -translate-x-1/2 rounded-full border border-border bg-surface-raised px-4 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-acid"
            >
              ESC · EXIT FULLSCREEN
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* insert palette */}
      <AnimatePresence>
        {adderOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdderOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="fixed right-4 top-14 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-panel)]"
            >
              <p className="px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                INSERT COMPONENT
              </p>
              {REGISTRY.map((r) => (
                <button
                  key={r.kind}
                  onClick={() => {
                    ws.add(r.kind, r.title);
                    setAdderOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-raised"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-sm border border-border bg-background/60 text-acid">
                    {r.glyph}
                  </span>
                  <span className="font-mono text-xs font-semibold tracking-wider">{r.title}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSwitchMode={switchMode} />
    </div>
  );
}
