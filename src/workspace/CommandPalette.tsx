import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "./store";
import { REGISTRY } from "./registry";
import { THEMES, useTheme } from "./theme";
import type { LayoutMode } from "./types";

interface Cmd {
  id: string;
  group: string;
  label: string;
  glyph: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onSwitchMode,
}: {
  open: boolean;
  onClose: () => void;
  onSwitchMode: (mode: LayoutMode) => void;
}) {
  const ws = useWorkspace();
  const { setTheme } = useTheme();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    REGISTRY.forEach((r) =>
      list.push({
        id: `insert-${r.kind}`,
        group: "Insert",
        label: `Insert ${r.title}`,
        glyph: r.glyph,
        run: () => ws.add(r.kind, r.title),
      }),
    );
    (["free", "grid", "stack", "split", "focus"] as LayoutMode[]).forEach((m) =>
      list.push({
        id: `mode-${m}`,
        group: "Layout",
        label: `Switch to ${m.toUpperCase()} layout`,
        glyph: "▦",
        run: () => onSwitchMode(m),
      }),
    );
    list.push({ id: "tab-new", group: "Spaces", label: "New space (tab)", glyph: "+", run: ws.addTab });
    ws.tabs.forEach((t) =>
      list.push({
        id: `tab-${t.id}`,
        group: "Spaces",
        label: `Go to space · ${t.name}`,
        glyph: "▚",
        run: () => ws.setActiveTab(t.id),
      }),
    );
    THEMES.forEach((t) =>
      list.push({
        id: `theme-${t.id}`,
        group: "Theme",
        label: `Theme · ${t.name}`,
        glyph: "◑",
        run: () => setTheme(t.id),
      }),
    );
    return list;
  }, [ws, setTheme, onSwitchMode]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + c.group).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  const runAt = (i: number) => {
    const c = filtered[i];
    if (!c) return;
    c.run();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[2000] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-acid)]"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="text-acid">⌘</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(filtered.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    runAt(active);
                  }
                }}
                placeholder="Type a command… insert, layout, space, theme"
                className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </span>
            </div>
            <div className="max-h-[52vh] overflow-auto p-2">
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">no matches</p>
              )}
              {filtered.map((c, i) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    i === active ? "bg-surface-raised" : ""
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-background/60 text-acid">
                    {c.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{c.label}</span>
                  </span>
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {c.group.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
