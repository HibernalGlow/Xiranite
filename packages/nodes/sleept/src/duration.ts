import type { SleeptInput } from "./core.js"

/**
 * The two duration derivations live here rather than in `core.ts` because every face needs them and only the
 * host may load `core.ts`: the countdown console shows the planned length *before* an operation exists, and a
 * terminal face that value-imports the node's core puts a second execution host in its own process (ADR-0074 §5,
 * counted by `scripts/audit-face-execution-path.ts`). Pure arithmetic, so it still bundles into the host and
 * still compiles for the browser GUI, which reads it through `@xiranite/node-sleept/duration`.
 */
export function countdownSeconds(input: Pick<SleeptInput, "hours" | "minutes" | "seconds">): number {
  return Math.max(0, Math.trunc(input.hours ?? 0) * 3600 + Math.trunc(input.minutes ?? 0) * 60 + Math.trunc(input.seconds ?? 0))
}

/** `HH:MM:SS`, the spelling the countdown's own progress events use. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.trunc(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
