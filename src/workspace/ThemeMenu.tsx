import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme, THEMES } from "./theme";

export function ThemeMenu() {
  const { theme, colorMode, setTheme, isDark, toggleDarkLight, setColorMode } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES.find((t) => t.id === theme)!;

  return (
    <div className="flex items-center gap-1.5">
      {/* Dark/Light toggle */}
      <button
        onClick={toggleDarkLight}
        className="flex h-8 w-8 items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        title="Toggle Dark/Light (D)"
      >
        {isDark ? (
          <span className="material-symbols-outlined text-[18px]">dark_mode</span>
        ) : (
          <span className="material-symbols-outlined text-[18px]">light_mode</span>
        )}
      </button>

      {/* Theme selector */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 items-center gap-2 rounded-sm border border-border bg-card/60 px-2.5 font-mono text-[11px] tracking-wider text-foreground hover:border-primary/40 transition-colors"
        >
          <span className="flex overflow-hidden rounded-[2px]">
            {current.swatch.map((c, i) => (
              <span key={i} className="h-4 w-2" style={{ backgroundColor: c }} />
            ))}
          </span>
          <span className="hidden sm:inline">{current.name}</span>
          <span className="text-muted-foreground text-[9px]">▾</span>
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
                className="absolute right-0 top-10 z-40 w-72 rounded-sm border border-border bg-card p-2 shadow-lg"
              >
                <p className="px-2 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground">SELECT THEME</p>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id);
                      setColorMode(t.defaultMode === "system" ? "system" : t.defaultMode);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-sm p-3 text-left transition-all ${
                      t.id === theme
                        ? "bg-primary/8 border border-primary/40"
                        : "border border-transparent hover:bg-muted/30 hover:border-border/60"
                    }`}
                  >
                    <span className="flex overflow-hidden rounded-[2px] border border-border/30 flex-shrink-0">
                      {t.swatch.map((c, i) => (
                        <span key={i} className="h-10 w-4" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t.name}</span>
                      <span className="block truncate text-[10px] font-mono text-muted-foreground/70 mt-0.5">{t.tag}</span>
                    </span>
                    {t.id === theme && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </button>
                ))}

                <div className="mt-2 pt-2 border-t border-border/40">
                  <p className="px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">COLOR MODE</p>
                  <div className="flex gap-1 px-2 py-1">
                    {(["light", "dark", "system"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setColorMode(m)}
                        className={`flex-1 px-2 py-1.5 rounded-sm font-mono text-[10px] border transition-colors ${
                          colorMode === m
                            ? "border-primary/40 text-primary bg-primary/10"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
