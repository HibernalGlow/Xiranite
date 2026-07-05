import { useState } from "react";
import { useWorkspace } from "./store";

export function TabBar() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="z-10 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background/50 px-2 py-1.5">
      {ws.tabs.map((tab) => {
        const active = tab.id === ws.activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => ws.setActiveTab(tab.id)}
            onDoubleClick={() => setEditing(tab.id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 py-1 font-mono text-[11px] tracking-wider transition-colors ${
              active
                ? "border-acid/60 bg-surface-raised text-foreground"
                : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-acid" : "bg-muted-foreground/40"}`} />
            {editing === tab.id ? (
              <input
                autoFocus
                defaultValue={tab.name}
                onBlur={(e) => {
                  ws.renameTab(tab.id, e.target.value.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-24 bg-transparent outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{tab.name}</span>
            )}
            <span className="rounded-[3px] bg-background/60 px-1 text-[9px] text-muted-foreground">
              {tab.panels.length}
            </span>
            {ws.tabs.length > 1 && (
              <button
                aria-label="close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  ws.closeTab(tab.id);
                }}
                className="grid h-4 w-4 place-items-center rounded-[3px] text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={ws.addTab}
        aria-label="new tab"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground hover:border-acid hover:text-acid"
      >
        +
      </button>
      <span className="ml-2 hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline">
        double-click to rename · each tab keeps its own layout & state
      </span>
    </div>
  );
}
