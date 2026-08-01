#!/usr/bin/env node
import { nodeCliName, writeError, writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import {
  runClipm,
  type ClipmActionResult,
  type ClipmGateway,
  type ClipmInput,
  type ClipmResult,
} from "./core.js"
import type { CmLabel, FeedbackOrigin, ReviewResolution, ReviewStatus } from "./generated/contracts.js"
import { createNodeClipmRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("clipm")

interface DisposableClipmGateway extends ClipmGateway {
  dispose?(): Promise<void>
}

export interface ClipmCliDependencies {
  createGateway(host: CliHost, jsonMode: boolean): Promise<DisposableClipmGateway>
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Score comics and manage CM feedback, training, models, and environment health.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = defaultHost(),
  dependencies: ClipmCliDependencies = defaultDependencies,
): Promise<void> {
  const json = args.includes("--json")
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    writeLine(host, usage())
    return
  }

  let gateway: DisposableClipmGateway | undefined
  try {
    const input = parseClipmCliArgs(args)
    gateway = await dependencies.createGateway(host, json)
    const result = await runClipm(input, gateway, json ? undefined : (event) => {
      if (event.type === "progress") host.stderr.write(`[${event.progress ?? 0}%] ${event.message}\n`)
    })
    if (json) writeJson(host, result)
    else renderHumanResult(host, result)
    if (!result.success) process.exitCode = 1
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  } finally {
    await gateway?.dispose?.().catch((error) => {
      writeError(host, `Failed to close the CM worker: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
  }
}

export function parseClipmCliArgs(args: string[]): ClipmInput {
  const values = positionalValues(args)
  const command = values[0]
  switch (command) {
    case "score":
      return {
        action: "score",
        path: required(values[1], "Usage: xclipm score <path> [options]"),
        scope: args.includes("--work") ? "work" : "library",
        scoreOptions: {
          rescore: args.includes("--rescore"),
          rename: !args.includes("--no-rename"),
          writeMetadata: !args.includes("--no-metadata"),
          dryRun: args.includes("--dry-run"),
        },
      }
    case "feedback":
      return parseFeedbackArgs(values, args)
    case "train":
      return { action: "train" }
    case "model":
      return parseModelArgs(values, args)
    case "env":
      if (values[1] === "migrate") {
        return {
          action: "env-migrate",
          targetRuntimeRoot: required(values[2], "Usage: xclipm env migrate <target-runtime-root> [--json]"),
        }
      }
      if (values[1] && values[1] !== "status") throw new Error("Usage: xclipm env [status] [--json]")
      return { action: "env-status" }
    default:
      throw new Error(`Unknown CM command: ${command ?? "(missing)"}\n${usage()}`)
  }
}

function parseFeedbackArgs(values: string[], args: string[]): ClipmInput {
  switch (values[1]) {
    case "scan":
      return { action: "feedback-scan", path: required(values[2], "Usage: xclipm feedback scan <path>") }
    case "apply":
      return {
        action: "feedback-apply",
        workId: required(values[2], "Usage: xclipm feedback apply <work-id> [--classification P|N|clear] [--ranking 0-1000|clear]"),
        classification: optionalClassification(flagValue(args, "--classification")),
        ranking: optionalRanking(flagValue(args, "--ranking")),
        source: optionalChoice(flagValue(args, "--source"), ["filename", "gui", "neoview"] as const, "feedback source") ?? "gui",
      }
    case "review":
      return {
        action: "review-list",
        reviewStatus: optionalChoice(flagValue(args, "--status"), ["pending", "resolved"] as const, "review status") ?? "pending",
        reviewLimit: optionalInteger(flagValue(args, "--limit"), 1, 1000, "review limit"),
      }
    case "resolve":
      return {
        action: "review-resolve",
        reviewId: required(values[2], "Usage: xclipm feedback resolve <review-id> --resolution <value>"),
        resolution: optionalChoice(
          flagValue(args, "--resolution"),
          ["use_filename", "use_json", "link_existing", "new_work"] as const,
          "review resolution",
        ) ?? missingValue("--resolution is required."),
        existingWorkId: flagValue(args, "--existing-work-id"),
      }
    default:
      throw new Error("Usage: xclipm feedback <scan|apply|review|resolve> ...")
  }
}

function parseModelArgs(values: string[], args: string[]): ClipmInput {
  switch (values[1]) {
    case "list":
      return { action: "model-list", includeFailed: !args.includes("--exclude-failed") }
    case "activate":
      return {
        action: "model-activate",
        bundleVersion: requiredInteger(values[2], 1, Number.MAX_SAFE_INTEGER, "model bundle version"),
        force: args.includes("--force"),
      }
    case "rollback":
      return {
        action: "model-rollback",
        bundleVersion: requiredInteger(values[2], 1, Number.MAX_SAFE_INTEGER, "rollback bundle version"),
      }
    default:
      throw new Error("Usage: xclipm model <list|activate|rollback> ...")
  }
}

function renderHumanResult(host: CliHost, result: ClipmResult): void {
  writeLine(host, result.message)
  if (!result.data) return
  renderActionResult(host, result.data.action, result.data.result)
}

function renderActionResult(host: CliHost, action: ClipmInput["action"], result: ClipmActionResult): void {
  if (action === "score") {
    const works = "works" in result ? result.works ?? [] : "workId" in result ? [result] : []
    for (const work of works) writeLine(host, `${work.label}\t${String(work.score).padStart(4, "0")}\tv${work.bundleVersion}\t${work.path}`)
    if ("failures" in result) {
      for (const failure of result.failures ?? []) writeLine(host, `ERROR\t${failure.errorType}\t${failure.path}\t${failure.message}`)
    }
    return
  }
  if (action === "model-list" && "models" in result) {
    for (const model of result.models) {
      writeLine(host, `${model.status}\tv${model.bundleVersion}\t${model.classificationValidationStatus}\t${model.rankingValidationStatus ?? "none"}`)
    }
    return
  }
  if (action === "review-list" && "items" in result) {
    for (const item of result.items) writeLine(host, `${item.status}\t${item.kind}\t${item.reviewId}\t${item.path}`)
    return
  }
  if (action === "env-status" && "healthy" in result) {
    writeLine(host, `${result.device}\tCUDA ${result.cudaAvailable ? "available" : "unavailable"}\tmodel v${result.activeBundleVersion ?? "--"}`)
    for (const warning of result.warnings ?? []) writeLine(host, `WARNING\t${warning}`)
    return
  }
  if (action === "env-migrate" && "targetRuntimeRoot" in result) {
    writeLine(host, `${result.sourceRuntimeRoot}\t${result.targetRuntimeRoot}`)
    for (const component of result.copiedComponents ?? []) writeLine(host, `COPIED\t${component}`)
  }
}

const valueFlags = new Set([
  "--classification",
  "--ranking",
  "--source",
  "--status",
  "--limit",
  "--resolution",
  "--existing-work-id",
])

function positionalValues(args: string[]): string[] {
  return args.filter((value, index) => !value.startsWith("-") && !valueFlags.has(args[index - 1] ?? ""))
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`)
  return value
}

function optionalClassification(value: string | undefined): CmLabel | null | undefined {
  if (value === undefined) return undefined
  if (value.toLowerCase() === "clear") return null
  const normalized = value.toUpperCase()
  if (normalized === "P" || normalized === "N") return normalized
  throw new Error("classification must be P, N, or clear.")
}

function optionalRanking(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined
  if (value.toLowerCase() === "clear") return null
  return requiredInteger(value, 0, 1000, "ranking")
}

function optionalInteger(value: string | undefined, minimum: number, maximum: number, label: string): number | undefined {
  return value === undefined ? undefined : requiredInteger(value, minimum, maximum, label)
}

function requiredInteger(value: string | undefined, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return parsed
}

function optionalChoice<const T extends readonly string[]>(value: string | undefined, choices: T, label: string): T[number] | undefined {
  if (value === undefined) return undefined
  if ((choices as readonly string[]).includes(value)) return value as T[number]
  throw new Error(`${label} must be one of: ${choices.join(", ")}.`)
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message)
  return value
}

function missingValue(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    "Usage:",
    `  ${CLI_NAME} score <path> [--work] [--rescore] [--dry-run] [--no-rename] [--no-metadata] [--json]`,
    `  ${CLI_NAME} feedback scan <path> [--json]`,
    `  ${CLI_NAME} feedback apply <work-id> [--classification P|N|clear] [--ranking 0-1000|clear] [--source gui|neoview|filename]`,
    `  ${CLI_NAME} feedback review [--status pending|resolved] [--limit 100]`,
    `  ${CLI_NAME} feedback resolve <review-id> --resolution use_filename|use_json|link_existing|new_work`,
    `  ${CLI_NAME} train [--json]`,
    `  ${CLI_NAME} model list [--exclude-failed] [--json]`,
    `  ${CLI_NAME} model activate <version> [--force] [--json]`,
    `  ${CLI_NAME} model rollback <version> [--json]`,
    `  ${CLI_NAME} env [status] [--json]`,
    `  ${CLI_NAME} env migrate <target-runtime-root> [--json]`,
  ].join("\n")
}

const defaultDependencies: ClipmCliDependencies = {
  createGateway: async (host, jsonMode) => createNodeClipmRuntime({
    cwd: host.cwd,
    env: host.env,
    jsonMode,
    stderr: host.stderr,
    onStderr: (message) => host.stderr.write(`${message}\n`),
  }),
}

function defaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
