#!/usr/bin/env node
import {
  canRunInteractiveCli,
  createCliHost,
  defineCommand,
  hasPipedInput,
  readStdinText,
  runMain,
  writeError,
  writeJson,
  writeLine,
} from "@xiranite/cli-runtime"
import type { CliHost } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"

import { runGitalso } from "./core.js"
import { createNodeGitalsoRuntime } from "./platform.js"

const CLI_NAME = "also"

interface DinyNodeConfig {
  diny_path?: string
  repo_path?: string
  no_verify?: boolean
  timeout?: number
}

function createDefaultHost(): CliHost {
  return createCliHost()
}

/** Extract a string value from citty's union arg type. */
function str(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Extract a boolean value from citty's union arg type. */
function bool(value: string | boolean | string[] | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

async function loadConfig(json: boolean): Promise<DinyNodeConfig | undefined> {
  const { config } = await loadNodeConfigWithHints<DinyNodeConfig>("gitalso", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  return config
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: {
      name: CLI_NAME,
      description: "Use diny by default for staged commits; optionally land a GitButler AI commit on its target branch.",
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Check diny installation and show staged file status." },
        args: {
          repoPath: { type: "string", description: "Git repository path.", alias: "path" },
          dinyPath: { type: "string", description: "Path to diny binary." },
          json: { type: "boolean", description: "Output as JSON." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const nodeConfig = await loadConfig(json)
          const result = await runGitalso({
            action: "status",
            repoPath: str(args.repoPath) ?? nodeConfig?.repo_path,
            dinyPath: str(args.dinyPath) ?? nodeConfig?.diny_path,
          }, createNodeGitalsoRuntime())
          if (json) writeJson(host, result)
          else writeLine(host, result.message)
          if (!result.success) process.exitCode = 1
        },
      }),
      generate: defineCommand({
        meta: { name: "generate", description: "Generate a commit message with diny AI without committing." },
        args: {
          repoPath: { type: "string", description: "Git repository path.", alias: "path" },
          dinyPath: { type: "string", description: "Path to diny binary." },
          noVerify: { type: "boolean", description: "Skip pre-commit hooks.", alias: "no-verify" },
          timeout: { type: "string", description: "Timeout in ms (default: 60000)." },
          json: { type: "boolean", description: "Output as JSON." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const nodeConfig = await loadConfig(json)
          const result = await runGitalso({
            action: "generate",
            repoPath: str(args.repoPath) ?? nodeConfig?.repo_path,
            dinyPath: str(args.dinyPath) ?? nodeConfig?.diny_path,
            noVerify: bool(args.noVerify) ?? nodeConfig?.no_verify,
            timeout: str(args.timeout) ? Number(args.timeout) : nodeConfig?.timeout,
          }, createNodeGitalsoRuntime())
          if (json) writeJson(host, result)
          else if (result.success && result.data?.commitMessage) writeLine(host, result.data.commitMessage)
          else writeLine(host, result.message)
          if (!result.success) process.exitCode = 1
        },
      }),
      commit: defineCommand({
        meta: { name: "commit", description: "Generate a commit message and create a git commit." },
        args: {
          repoPath: { type: "string", description: "Git repository path.", alias: "path" },
          dinyPath: { type: "string", description: "Path to diny binary." },
          message: { type: "string", description: "Manual commit message (skip diny generation).", alias: "m" },
          noVerify: { type: "boolean", description: "Skip pre-commit hooks.", alias: "no-verify" },
          dryRun: { type: "boolean", description: "Preview without committing." },
          timeout: { type: "string", description: "Timeout in ms (default: 60000)." },
          json: { type: "boolean", description: "Output as JSON." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const nodeConfig = await loadConfig(json)
          let message = str(args.message)
          if (!message && hasPipedInput(host.stdin)) {
            const stdinText = await readStdinText(host.stdin)
            if (stdinText.trim()) message = stdinText.trim()
          }
          const result = await runGitalso({
            action: "commit",
            repoPath: str(args.repoPath) ?? nodeConfig?.repo_path,
            dinyPath: str(args.dinyPath) ?? nodeConfig?.diny_path,
            message,
            noVerify: bool(args.noVerify) ?? nodeConfig?.no_verify,
            dryRun: bool(args.dryRun),
            timeout: str(args.timeout) ? Number(args.timeout) : nodeConfig?.timeout,
          }, createNodeGitalsoRuntime())
          if (json) writeJson(host, result)
          else writeLine(host, result.message)
          if (!result.success) process.exitCode = 1
        },
      }),
      push: defineCommand({
        meta: { name: "push", description: "Generate, commit, and push in one step." },
        args: {
          repoPath: { type: "string", description: "Git repository path.", alias: "path" },
          dinyPath: { type: "string", description: "Path to diny binary." },
          message: { type: "string", description: "Manual commit message (skip diny generation).", alias: "m" },
          noVerify: { type: "boolean", description: "Skip pre-commit hooks.", alias: "no-verify" },
          dryRun: { type: "boolean", description: "Preview without committing." },
          timeout: { type: "string", description: "Timeout in ms (default: 60000)." },
          json: { type: "boolean", description: "Output as JSON." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const nodeConfig = await loadConfig(json)
          let message = str(args.message)
          if (!message && hasPipedInput(host.stdin)) {
            const stdinText = await readStdinText(host.stdin)
            if (stdinText.trim()) message = stdinText.trim()
          }
          const result = await runGitalso({
            action: "push",
            repoPath: str(args.repoPath) ?? nodeConfig?.repo_path,
            dinyPath: str(args.dinyPath) ?? nodeConfig?.diny_path,
            message,
            noVerify: bool(args.noVerify) ?? nodeConfig?.no_verify,
            dryRun: bool(args.dryRun),
            timeout: str(args.timeout) ? Number(args.timeout) : nodeConfig?.timeout,
          }, createNodeGitalsoRuntime())
          if (json) writeJson(host, result)
          else writeLine(host, result.message)
          if (!result.success) process.exitCode = 1
        },
      }),
      gitbutler: defineCommand({
        meta: { name: "gitbutler", description: "Create an AI commit with GitButler and land it on the configured target branch." },
        args: {
          repoPath: { type: "string", description: "Git repository path.", alias: "path" },
          json: { type: "boolean", description: "Output as JSON." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const nodeConfig = await loadConfig(json)
          const result = await runGitalso({ action: "gitbutler_commit", repoPath: str(args.repoPath) ?? nodeConfig?.repo_path }, createNodeGitalsoRuntime())
          if (json) writeJson(host, result)
          else writeLine(host, result.message)
          if (!result.success) process.exitCode = 1
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Interactive guided mode." },
        async run() {
          if (!canRunInteractiveCli(host)) {
            writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} generate --path <repo> --json\` for scripted use.`)
            process.exitCode = 2
            return
          }
          const result = await runGitalso({ action: "generate" }, createNodeGitalsoRuntime())
          writeLine(host, result.message)
          if (result.success && result.data?.commitMessage) {
            writeLine(host, `\nGenerated message:\n  ${result.data.commitMessage}`)
            writeLine(host, `\nRun \`${CLI_NAME} commit --message "${result.data.commitMessage}"\` to commit.`)
          }
        },
      }),
    },
  })
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    // No args → guided mode
    await runMain(createProgram(host), { rawArgs: ["guided"] })
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
