import { useEffect, useState } from "react";

/** Each demo component holds its own internal state. Because panels are never
 *  unmounted across layout changes, this state persists through every morph. */

export function NotesComponent() {
  const [text, setText] = useState("// scratch buffer\nlayout state never resets this text.\n");
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      spellCheck={false}
      className="h-full w-full resize-none rounded-sm bg-background/60 p-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-acid/60"
      placeholder="type anything…"
    />
  );
}

export function CounterComponent() {
  const [n, setN] = useState(0);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="text-acid-gradient font-mono text-6xl font-bold tabular-nums">{n}</div>
      <div className="flex gap-2">
        <button
          onClick={() => setN((v) => v - 1)}
          className="rounded-sm border border-border bg-surface-raised px-4 py-1.5 font-mono text-sm hover:border-magenta hover:text-magenta"
        >
          −
        </button>
        <button
          onClick={() => setN(0)}
          className="rounded-sm border border-border bg-surface-raised px-4 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          RESET
        </button>
        <button
          onClick={() => setN((v) => v + 1)}
          className="rounded-sm border border-border bg-surface-raised px-4 py-1.5 font-mono text-sm hover:border-acid hover:text-acid"
        >
          +
        </button>
      </div>
      <p className="text-center text-xs text-muted-foreground">state is stateful — resize / re-layout freely</p>
    </div>
  );
}

export function MixerComponent() {
  const [h, setH] = useState(115);
  const [s, setS] = useState(90);
  const [l, setL] = useState(60);
  const color = `hsl(${h} ${s}% ${l}%)`;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 rounded-sm bg-scan" style={{ backgroundColor: color, boxShadow: `0 0 40px ${color}` }} />
      {[
        { label: "H", value: h, max: 360, set: setH },
        { label: "S", value: s, max: 100, set: setS },
        { label: "L", value: l, max: 100, set: setL },
      ].map((row) => (
        <label key={row.label} className="flex items-center gap-2 font-mono text-xs">
          <span className="w-4 text-acid">{row.label}</span>
          <input
            type="range"
            min={0}
            max={row.max}
            value={row.value}
            onChange={(e) => row.set(Number(e.target.value))}
            className="h-1 flex-1 accent-[oklch(0.85_0.23_115)]"
          />
          <span className="w-8 text-right text-muted-foreground">{row.value}</span>
        </label>
      ))}
    </div>
  );
}

export function TerminalComponent() {
  const [lines, setLines] = useState<string[]>([
    "GRIDLOCK v0.9 // kernel online",
    "> mounting spatial workspace…",
    "> ok",
  ]);
  const [input, setInput] = useState("");
  const run = () => {
    if (!input.trim()) return;
    setLines((l) => [...l, `$ ${input}`, `→ executed "${input}"`]);
    setInput("");
  };
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex-1 overflow-auto rounded-sm bg-background/70 p-2 font-mono text-xs leading-relaxed text-cyan">
        {lines.map((l, i) => (
          <div key={i} className={l.startsWith("$") ? "text-acid" : ""}>
            {l}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-acid">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder="type a command + enter"
        />
      </div>
    </div>
  );
}

export function TasksComponent() {
  const [tasks, setTasks] = useState([
    { t: "wire layout engine", done: true },
    { t: "morph without remount", done: true },
    { t: "cross-panel actions", done: false },
  ]);
  const [draft, setDraft] = useState("");
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex-1 space-y-1.5 overflow-auto">
        {tasks.map((task, i) => (
          <button
            key={i}
            onClick={() => setTasks((ts) => ts.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
            className="flex w-full items-center gap-2 rounded-sm border border-border bg-surface-raised/60 px-2 py-1.5 text-left text-sm hover:border-acid/60"
          >
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border ${task.done ? "border-acid bg-acid text-acid-foreground" : "border-muted-foreground"}`}>
              {task.done ? "✓" : ""}
            </span>
            <span className={task.done ? "text-muted-foreground line-through" : ""}>{task.t}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              setTasks((t) => [...t, { t: draft, done: false }]);
              setDraft("");
            }
          }}
          className="flex-1 rounded-sm border border-border bg-background/60 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-acid/60"
          placeholder="new task…"
        />
      </div>
    </div>
  );
}

export function ClockComponent() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  const ss = now.getSeconds().toString().padStart(2, "0");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <div className="text-acid-gradient font-mono text-5xl font-bold tabular-nums">
        {hh}:{mm}
        <span className="text-2xl align-top">{ss}</span>
      </div>
      <div className="font-mono text-xs tracking-widest text-muted-foreground">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}
      </div>
    </div>
  );
}

export function CalcComponent() {
  const [expr, setExpr] = useState("");
  const [out, setOut] = useState("0");
  const keys = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
  const press = (k: string) => {
    if (k === "=") {
      try {
        // eslint-disable-next-line no-new-func
        const r = Function(`"use strict";return (${expr || "0"})`)();
        setOut(String(r));
      } catch {
        setOut("ERR");
      }
      return;
    }
    setExpr((e) => e + k);
  };
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="rounded-sm bg-background/60 p-2 text-right font-mono">
        <div className="truncate text-xs text-muted-foreground">{expr || "\u00a0"}</div>
        <div className="truncate text-2xl text-acid">{out}</div>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            className={`rounded-sm border border-border font-mono text-sm transition-colors hover:border-acid hover:text-acid ${
              k === "=" ? "bg-acid/15 text-acid" : "bg-surface-raised"
            }`}
          >
            {k}
          </button>
        ))}
        <button
          onClick={() => {
            setExpr("");
            setOut("0");
          }}
          className="col-span-4 rounded-sm border border-border bg-surface-raised py-1 font-mono text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
        >
          CLEAR
        </button>
      </div>
    </div>
  );
}

interface Card {
  id: number;
  text: string;
  col: number;
}

/** Demonstrates the "many small cards inside one component" pattern —
 *  a nested board of sub-cards living entirely inside a single panel. */
export function KanbanComponent() {
  const cols = ["BACKLOG", "ACTIVE", "DONE"];
  const [cards, setCards] = useState<Card[]>([
    { id: 1, text: "spatial engine", col: 2 },
    { id: 2, text: "tab spaces", col: 2 },
    { id: 3, text: "command palette", col: 1 },
    { id: 4, text: "nested sub-cards", col: 1 },
    { id: 5, text: "sync free layout", col: 0 },
    { id: 6, text: "more components", col: 0 },
  ]);
  const move = (id: number, dir: number) =>
    setCards((cs) =>
      cs.map((c) => (c.id === id ? { ...c, col: Math.max(0, Math.min(2, c.col + dir)) } : c)),
    );
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      {cols.map((name, ci) => (
        <div key={name} className="flex min-h-0 flex-col rounded-sm border border-border bg-background/40">
          <div className="border-b border-border px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">
            {name} · {cards.filter((c) => c.col === ci).length}
          </div>
          <div className="flex-1 space-y-1.5 overflow-auto p-1.5">
            {cards
              .filter((c) => c.col === ci)
              .map((c) => (
                <div
                  key={c.id}
                  className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs"
                >
                  <div className="mb-1 truncate">{c.text}</div>
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <button disabled={ci === 0} onClick={() => move(c.id, -1)} className="disabled:opacity-20 hover:text-acid">
                      ←
                    </button>
                    <button disabled={ci === 2} onClick={() => move(c.id, 1)} className="disabled:opacity-20 hover:text-acid">
                      →
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

