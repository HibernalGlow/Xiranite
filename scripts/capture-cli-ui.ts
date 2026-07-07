#!/usr/bin/env -S node --experimental-strip-types
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { defineCommand, runMain } from "@xiranite/cli-runtime"
import { captureCliVisual, expectCliVisualArtifacts } from "./cli-visual-testing.ts"

const command = defineCommand({
  meta: {
    name: "capture-cli-ui",
    description: "Capture a real pseudo-tty CLI screen as ANSI, HTML, and PNG artifacts.",
  },
  args: {
    node: {
      type: "string",
      description: "Node id used for artifacts/cli/<node>.",
    },
    cli: {
      type: "string",
      description: "Path to the CLI entry file.",
    },
    case: {
      type: "string",
      description: "Artifact basename.",
    },
    wait: {
      type: "string",
      description: "Text that must appear before the capture closes the CLI.",
    },
    args: {
      type: "string",
      description: "Optional JSON string array of CLI args, for example [\"guided\"]. Defaults to [].",
    },
  },
  async run({ args }) {
    const nodeId = requiredString(args.node, "--node")
    const cliPath = resolve(requiredString(args.cli, "--cli"))
    const artifactName = requiredString(args.case, "--case")
    const waitForText = requiredString(args.wait, "--wait")
    const cliArgs = parseCliArgs(args.args)

    const capture = await captureCliVisual({
      nodeId,
      cliPath,
      args: cliArgs,
      artifactName,
      waitForText,
    })
    await expectCliVisualArtifacts(capture)

    process.stdout.write(`ANSI: ${capture.ansiPath}\n`)
    process.stdout.write(`HTML: ${capture.htmlPath}\n`)
    process.stdout.write(`PNG:  ${capture.pngPath}\n`)
  },
})

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value
  throw new Error(`Missing required ${name}.`)
}

function parseCliArgs(value: unknown): string[] {
  if (value === undefined || value === "") return []
  if (typeof value !== "string") throw new Error("--args must be a JSON string array.")
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("--args must be a JSON string array.")
  }
  return parsed
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (isBunRuntime()) {
    process.stderr.write("Use Node as the parent process for node-pty captures: node --experimental-strip-types scripts/capture-cli-ui.ts ...\n")
    process.exit(2)
  }

  try {
    await runMain(command, { rawArgs: process.argv.slice(2) })
    process.exit(0)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

function isBunRuntime(): boolean {
  return Boolean((globalThis as { Bun?: unknown }).Bun)
}
