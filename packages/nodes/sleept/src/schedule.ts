/**
 * The sleep-timer vocabulary and its one parser — shared by three faces, defined once.
 *
 * `core.ts` re-exports these names, so the host-side operation contract is unchanged. The implementation
 * lives *here* rather than in `core.ts` on purpose: the terminal schema in `interaction.ts` needs
 * `POWER_MODE_VALUES` and `parseTargetDatetime` as **values**, and a value import of `core.ts` evaluates the
 * whole engine module in the face process (ADR-0074 §5) — which for the GUI means the browser chunk ships
 * a second copy of the node's business logic. A module that imports nothing from `core.js` is the seam.
 */

/**
 * The machine state a timer asks for — one list, three faces. `display-sleep` and `screensaver` are
 * session-level and reversible (they blank or decorate the screen without touching running work), while the
 * other four take the machine down; every one of them still goes through the same `dryrun` gate.
 *
 * `PowerMode` is *derived from* this array rather than written beside it: the vocabulary the CLI, the TUI,
 * the GUI and the manifest all read is this one value, and `satisfies Record<PowerMode, …>` downstream turns
 * a face that forgot a mode into a type error instead of a silently missing option.
 */
export const POWER_MODE_VALUES = ["sleep", "hibernate", "shutdown", "restart", "display-sleep", "screensaver"] as const

/** One of {@link POWER_MODE_VALUES}; derived, never written beside the list. */
export type PowerMode = (typeof POWER_MODE_VALUES)[number]

/** How the network-rate trigger combines the up and down thresholds. */
export type NetTriggerMode = "both" | "any"

/**
 * Parse the `specific_time` target.
 *
 * `now` is injectable because the host realm answers "what time is it" and a test must be able to pin it;
 * a target that is not strictly in the future is an error rather than an immediate fire.
 */
export function parseTargetDatetime(value: string, now = new Date()): Date {
  const normalized = value.trim().replace(" ", "T")
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid datetime. Use YYYY-MM-DD HH:MM:SS.")
  }
  if (parsed <= now) {
    throw new Error("Target datetime must be in the future.")
  }
  return parsed
}
