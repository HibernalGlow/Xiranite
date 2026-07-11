import type { CliHost } from "./index.js"

export type InteractionMode = "ui" | "gd"
export type CliInvocationMode = InteractionMode | "pipe"

/**
 * Routes an invocation without ever accidentally rendering an interactive UI
 * into a pipeline. `guided` is retained as the legacy spelling of `gd`.
 */
export function resolveCliInvocation(args: readonly string[], host: CliHost, defaultMode: InteractionMode = "ui"): CliInvocationMode {
  const first = args[0]?.toLowerCase()
  if (first === "ui") return "ui"
  if (first === "gd" || first === "guided") return "gd"
  if (args.length > 0) return "pipe"
  return host.stdin.isTTY && host.stdout.isTTY ? defaultMode : "pipe"
}

export function requireInteractiveMode(host: CliHost, mode: InteractionMode): string | null {
  return host.stdin.isTTY && host.stdout.isTTY ? null : `\`${mode}\` mode requires an interactive terminal. Use a subcommand with --json for scripted use.`
}
