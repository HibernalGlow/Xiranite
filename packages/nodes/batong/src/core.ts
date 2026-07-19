import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type BatongAction = "convert" | "list" | "install" | "doctor" | "uninstall"
export type BatongAgent = "claude" | "opencode" | "codex" | "gemini" | "zed" | "aider"

export interface BatongInput {
  action?: BatongAction
  from?: string
  to?: string
  sessionPath?: string
  latest?: boolean
  import?: boolean
  /** Exact Baton argument tail for CLI forwarding; takes precedence over structured fields. */
  rawArgs?: string[]
  /** Forward-compatible Baton flags passed after the generated command. */
  extraArgs?: string[]
}

export interface BatongCommandPlan {
  command: string
  args: string[]
  action: BatongAction
}

export interface BatongCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface BatongData {
  command: BatongCommandPlan
  result?: BatongCommandResult
  output: string
  errors: string[]
}

export interface BatongRuntime {
  findCommand: () => Promise<string | undefined>
  runCommand: (plan: BatongCommandPlan) => Promise<BatongCommandResult>
}

export type BatongResult = NodeRunResult<BatongData>

const KNOWN_ACTIONS = new Set<BatongAction>(["convert", "list", "install", "doctor", "uninstall"])

export function parseBatongAction(value?: string): BatongAction | undefined {
  return value && KNOWN_ACTIONS.has(value as BatongAction) ? value as BatongAction : undefined
}

export function normalizeExtraArgs(args?: string[]): string[] {
  return (args ?? []).map((arg) => arg.trim()).filter(Boolean)
}

export function createBatongCommand(input: BatongInput): BatongCommandPlan {
  if (input.rawArgs?.length) {
    const action = parseBatongAction(input.rawArgs[0])
    if (!action) throw new Error(`Unknown Baton command: ${input.rawArgs[0] ?? ""}.`)
    return { command: "baton", args: [...input.rawArgs], action }
  }

  const action = input.action ?? "convert"
  const args: string[] = [action]

  if (action === "convert") {
    const from = input.from?.trim()
    const to = input.to?.trim()
    if (!from || !to) throw new Error("Baton conversion requires both --from and --to agent formats.")
    args.push("--from", from, "--to", to)
    if (input.latest) args.push("--latest")
    if (input.import) args.push("--import")
    const sessionPath = input.sessionPath?.trim()
    if (sessionPath) args.push(sessionPath)
  }

  args.push(...normalizeExtraArgs(input.extraArgs))
  return { command: "baton", args, action }
}

export async function runBatong(
  input: BatongInput,
  runtime: BatongRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<BatongResult> {
  let command: BatongCommandPlan
  try {
    command = createBatongCommand(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message, data: emptyData(message) }
  }

  const executable = await runtime.findCommand()
  if (!executable) {
    const message = "Baton is not installed or is not available on PATH. Install @kasabeh/baton-mcp to enable session migration."
    return { success: false, message, data: { ...emptyData(message), command } }
  }

  const plan = { ...command, command: executable }
  onEvent({ type: "log", message: `Running ${formatCommand(plan)}.` })
  const result = await runtime.runCommand(plan)
  const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "").trim()
  const errors = result.code === 0 ? [] : [output || `Baton exited with code ${result.code}.`]
  const message = result.code === 0
    ? `${labelForAction(plan.action)} completed.`
    : `${labelForAction(plan.action)} failed (exit ${result.code}).`
  onEvent({ type: "progress", progress: 100, message })
  return { success: result.code === 0, message, data: { command: plan, result, output, errors } }
}

export function formatCommand(plan: BatongCommandPlan): string {
  return [plan.command, ...plan.args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ")
}

function emptyData(error: string): BatongData {
  return { command: { command: "baton", args: [], action: "convert" }, output: "", errors: [error] }
}

function labelForAction(action: BatongAction): string {
  if (action === "convert") return "Session conversion"
  if (action === "list") return "Session scan"
  if (action === "install") return "MCP installation"
  if (action === "doctor") return "Baton diagnosis"
  return "MCP uninstallation"
}
