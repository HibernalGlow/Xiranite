import { memo } from "react";
import { motion } from "motion/react";
import type { ComputedLayout } from "./types";
import { useWorkspace } from "./store";
import { registryByKind } from "./registry";

const stateLabel: Record<string, string> = {
  docked: "DOCKED",
  floating: "FLOAT",
  compact: "COMPACT",
  focused: "FOCUS",
  fullscreen: "FULL",
};

function PanelInner({
  id,
  kind,
  title,
  layout,
  canvasRef,
}: {
  id: string;
  kind: string;
  title: string;
  layout: ComputedLayout;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ws = useWorkspace();
  const reg = registryByKind(kind);
  const isFullscreen = layout.state === "fullscreen";
  const isCompact = layout.state === "compact";
  const isTiny = layout.w < 240;

  return (
    <motion.div
      drag={ws.mode === "free" && !isFullscreen}
      dragMomentum={false}
      dragConstraints={canvasRef}
      onPointerDown={() => ws.raise(id)}
      onDragEnd={(_, info) => {
        ws.move(id, {
          x: Math.max(0, layout.x + info.offset.x),
          y: Math.max(0, layout.y + info.offset.y),
        });
      }}
      initial={false}
      animate={{
        x: layout.x,
        y: layout.y,
        width: layout.w,
        height: layout.h,
        opacity: layout.opacity,
        scale: layout.scale,
      }}
      transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.7 }}
      style={{ position: "absolute", zIndex: layout.z, pointerEvents: layout.interactive ? "auto" : "none" }}
      className={`group flex flex-col overflow-hidden rounded-md border bg-surface backdrop-blur-sm ${
        layout.state === "focused" || isFullscreen
          ? "border-acid/60 shadow-[var(--shadow-acid)]"
          : "border-border shadow-[var(--shadow-panel)]"
      }`}
    >
      {/* header */}
      <div
        className={`flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 ${
          ws.mode === "free" && !isFullscreen ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <span className="text-acid">{reg?.glyph}</span>
        <span className="truncate font-mono text-xs font-semibold tracking-wider text-foreground">
          {title}
        </span>
        <span className="ml-1 rounded-[3px] bg-background/60 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
          {stateLabel[layout.state]}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          <HeaderBtn label="collapse" onClick={() => ws.toggleCollapse(id)}>
            {isCompact ? "▢" : "▬"}
          </HeaderBtn>
          <HeaderBtn label="focus" onClick={() => { ws.setMode("focus"); ws.focus(id); }}>
            ◎
          </HeaderBtn>
          <HeaderBtn label="fullscreen" onClick={() => ws.setFullscreen(isFullscreen ? null : id)}>
            {isFullscreen ? "✕" : "⤢"}
          </HeaderBtn>
          <HeaderBtn label="close" danger onClick={() => ws.remove(id)}>
            ×
          </HeaderBtn>
        </div>
      </div>

      {/* body — always mounted so component state survives every layout morph */}
      <div className={`min-h-0 flex-1 ${isCompact ? "hidden" : "block"} ${isTiny ? "p-1.5" : "p-3"}`}>
        {isTiny ? (
          <div className="grid h-full place-items-center text-center text-[10px] text-muted-foreground">
            <span>{title}<br />live</span>
          </div>
        ) : (
          reg?.render()
        )}
      </div>
    </motion.div>
  );
}

function HeaderBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-6 w-6 place-items-center rounded-[3px] border border-transparent font-mono text-xs text-muted-foreground transition-colors hover:border-border ${
        danger ? "hover:bg-destructive hover:text-destructive-foreground" : "hover:bg-background hover:text-acid"
      }`}
    >
      {children}
    </button>
  );
}

export const Panel = memo(PanelInner);
