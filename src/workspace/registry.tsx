import type { ReactNode } from "react";
import {
  CalcComponent,
  ClockComponent,
  CounterComponent,
  KanbanComponent,
  MixerComponent,
  NotesComponent,
  TasksComponent,
  TerminalComponent,
} from "./components";

export interface Registry {
  kind: string;
  title: string;
  glyph: string;
  render: () => ReactNode;
}

export const REGISTRY: Registry[] = [
  { kind: "notes", title: "SCRATCH", glyph: "✎", render: () => <NotesComponent /> },
  { kind: "counter", title: "COUNTER", glyph: "◈", render: () => <CounterComponent /> },
  { kind: "mixer", title: "ACID MIXER", glyph: "◐", render: () => <MixerComponent /> },
  { kind: "terminal", title: "TERMINAL", glyph: "▚", render: () => <TerminalComponent /> },
  { kind: "tasks", title: "TASKS", glyph: "☰", render: () => <TasksComponent /> },
  { kind: "clock", title: "CLOCK", glyph: "◷", render: () => <ClockComponent /> },
  { kind: "calc", title: "CALCULATOR", glyph: "⊞", render: () => <CalcComponent /> },
  { kind: "kanban", title: "KANBAN BOARD", glyph: "▤", render: () => <KanbanComponent /> },
];

export const registryByKind = (kind: string) => REGISTRY.find((r) => r.kind === kind);
