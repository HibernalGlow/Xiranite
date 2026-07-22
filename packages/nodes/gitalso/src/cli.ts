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
  runGuidedInteraction,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, updateNodeConfigFile } from "@xiranite/config"

import { runGitalso } from "./core.js"
import { createNodeGitalsoRuntime } from "./platform.js"
import { createGitalsoInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

const CLI_NAME = "also"
export const cli: CliCommand = { name: CLI_NAME, description: "Repository workbench and commit-message assistant.", run: (args, host) => runProgram(args, host) }

interface DinyNodeConfig extends CliInteractionPreferencesSource {
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

async function legacyRunProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    // No args → guided mode
    await runMain(createProgram(host), { rawArgs: ["guided"] })
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  await runInteractionCli({ args, host, cliName: CLI_NAME,
    loadContext: async () => { const { config } = await loadNodeConfigWithHints<DinyNodeConfig>("gitalso", { env: host.env, cwd: host.cwd, hintSink: { stderr: host.stderr }, jsonMode: true }); return { preferences: resolveInteractionPreferences(config), value: config ?? {} } },
    createDefinition: (defaults, language) => ({ schema: createGitalsoInteractionSchema({ repoPath: defaults.repo_path, noVerify: defaults.no_verify, dryRun: true }, language), run: (input, event) => runGitalso(input, createNodeGitalsoRuntime(), event) }),
    runPipe: (pipeArgs, pipeHost) => pipeArgs.length ? runMain(createProgram(pipeHost), { rawArgs: pipeArgs }) : Promise.resolve(writeLine(pipeHost, `${CLI_NAME} ui | gd | status | generate | commit | push`)),
    runGuide: runGuidedInteraction, runUi: runTerminalUi, loadScreen: async () => (await import("./Tui.js")).GitalsoTui,
    createPreferences: (_defaults, current) => ({ nodeId: "gitalso", current, save: async (values) => { await updateNodeConfigFile("gitalso", { cli: { theme: values.theme, default_mode: values.defaultMode, language: values.language } }, { env: host.env, cwd: host.cwd }) }, restore: async () => current } satisfies TerminalPreferenceController),
    reexecEntrypoint: process.argv[1], help,
  })
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
