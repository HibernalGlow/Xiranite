import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { THEMES, useTheme } from "./theme";

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES.find((t) => t.id === theme)!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-sm border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-foreground hover:border-acid/60"
      >
        <span className="flex gap-0.5">
          {current.swatch.map((c) => (
            <span key={c} className="h-3 w-1.5 rounded-[1px]" style={{ backgroundColor: c }} />
          ))}
        </span>
        {current.name}
        <span className="text-muted-foreground">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute right-0 top-10 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-panel)]"
            >
              <p className="px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">THEME</p>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors ${
                    t.id === theme ? "bg-surface-raised" : "hover:bg-surface-raised"
                  }`}
                >
                  <span className="flex overflow-hidden rounded-[3px]">
                    {t.swatch.map((c) => (
                      <span key={c} className="h-8 w-3" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold tracking-wider">{t.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{t.tag}</span>
                  </span>
                  {t.id === theme && <span className="ml-auto text-acid">◎</span>}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
