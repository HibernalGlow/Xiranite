#!/usr/bin/env node
import {
  defineCommand,
  hasPipedInput,
  nodeCliName,
  readStdinLines,
  runGuidedInteraction,
  runMain,
  writeError,
  writeJson,
  writeLine,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import {
  requireInteractiveMode,
  resolveCliInvocation,
  resolveInteractionPreferences,
  resolveTerminalUiFlags,
  type CliInteractionPreferencesSource,
  type TerminalInteractionDefinition,
  type TerminalRenderer,
} from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { listTerminalThemes, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config"
import {
  defaultGifuInput,
  parsePathList,
  runGifu,
  type GifuAction,
  type GifuFormat,
  type GifuInput,
  type GifuOutputMode,
  type GifuResult,
  type GifuRuntime,
} from "./core.js"
import { createGifuInteractionSchema, type GifuInteractionValues } from "./interaction.js"
import { createNodeGifuRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("gifu")

interface GifuNodeConfig extends CliInteractionPreferencesSource {
  paths?: string[]
  recursive?: boolean
  format?: GifuFormat
  out_mode?: GifuOutputMode
  out_dir?: string
  name_prefix?: string
  name_template?: string
  duration_ms?: number
  loop?: number
  quality?: number
  webp_method?: number
  ffmpeg_threads?: number
  webm_crf?: number
  webm_cpu_used?: number
  mp4_preset?: string
  mp4_cq?: number
  max_workers?: number
  extract_single?: boolean
  overwrite?: boolean
  dry_run?: boolean
  record_run?: boolean
  database_path?: string
  legacy_config_path?: string
}

interface GifuDefaults extends Partial<GifuInteractionValues> {
  interactionMode?: "ui" | "gd" | "pipe"
  interactionRenderer?: TerminalRenderer
  interactionLanguage?: TerminalLanguage
  interactionTheme?: string
}

interface GifuCliOptions {
  paths?: string
  config?: string
  listFile?: string
  recursive?: boolean
  noRecursive?: boolean
  format?: string
  outDir?: string
  outMode?: string
  namePrefix?: string
  nameTemplate?: string
  duration?: string
  loop?: string
  quality?: string
  webpMethod?: string
  ffmpegThreads?: string
  webmCrf?: string
  webmCpuUsed?: string
  mp4Preset?: string
  mp4Cq?: string
  maxWorkers?: string
  extractSingle?: boolean
  noExtractSingle?: boolean
  overwrite?: boolean
  dryRun?: boolean
  live?: boolean
  recordRun?: boolean
  databasePath?: string
  json?: boolean
}

export interface GifuCliDependencies {
  createRuntime: () => GifuRuntime
  runGuide: <Input, Result>(definition: TerminalInteractionDefinition<Input, Result>, options: { host: CliHost; language: TerminalLanguage }) => Promise<void>
  runUi: typeof runTerminalUi
}

const defaultDependencies: GifuCliDependencies = {
  createRuntime: createNodeGifuRuntime,
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Native archive-to-animation converter with ui, gd, and pipe modes.",
  async run(args, host) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createDefaultHost(),
  dependencies: GifuCliDependencies = defaultDependencies,
): Promise<void> {
  if (args.length === 0 && (!host.stdin.isTTY || !host.stdout.isTTY)) {
    writeError(host, `No interactive terminal detected. Use \`${CLI_NAME} inspect - --json\` for stdin or run \`${CLI_NAME} ui\` in a terminal.`)
    process.exitCode = 2
    return
  }

  const explicitInvocation = resolveCliInvocation(args, host, "ui")
  if (args.length > 0 && explicitInvocation !== "pipe") {
    const ttyError = requireInteractiveMode(host, explicitInvocation)
    if (ttyError) {
      writeError(host, ttyError)
      process.exitCode = 2
      return
    }
  }

  if (explicitInvocation === "pipe" || args.includes("--help") || args.includes("-h")) {
    await runMain(createProgram(host, dependencies), { rawArgs: normalizeMultiplePaths(args) })
    return
  }

  const defaults = await resolveGifuDefaults(host, true)
  const invocation = args.length === 0 ? resolveCliInvocation(args, host, defaults.interactionMode ?? "ui") : explicitInvocation
  const flags = resolveTerminalUiFlags(args.slice(1), {
    renderer: defaults.interactionRenderer ?? "opentui",
    language: defaults.interactionLanguage ?? resolveTerminalLanguage(undefined, host.env),
    theme: defaults.interactionTheme,
  })
  if (flags.error || flags.args.length || !flags.renderer || !flags.language) {
    writeError(host, flags.error ?? `Unknown terminal argument: ${flags.args[0]}.`)
    process.exitCode = 2
    return
  }
  if (flags.theme && flags.theme !== "inherit" && !listTerminalThemes().includes(flags.theme)) {
    writeError(host, `Unknown terminal theme: ${flags.theme}. Available themes: ${listTerminalThemes().join(", ")}.`)
    process.exitCode = 2
    return
  }

  const definition = createGifuUiDefinition(defaults, flags.language, dependencies.createRuntime)
  if (invocation === "gd") {
    await dependencies.runGuide(definition, { host, language: flags.language })
    return
  }
  await dependencies.runUi(definition, {
    host,
    renderer: flags.renderer,
    language: flags.language,
    theme: flags.theme,
    loadScreen: async () => (await import("./Tui.js")).GifuTui,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args } : undefined,
  })
}

export function createGifuUiDefinition(
  defaults: GifuDefaults,
  language: TerminalLanguage,
  createRuntime: () => GifuRuntime,
): TerminalInteractionDefinition<GifuInput, GifuResult> {
  let activeRuntime: GifuRuntime | undefined
  return {
    schema: createGifuInteractionSchema(defaults, language),
    async run(input, onEvent) {
      activeRuntime = createRuntime()
      return runGifu(input, activeRuntime, onEvent)
    },
    cancel() {
      activeRuntime?.cancel?.()
    },
  }
}

function createProgram(host: CliHost = createDefaultHost(), dependencies: GifuCliDependencies = defaultDependencies) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Native archive-to-animation converter with OpenTUI, guide, and pipeline modes." },
    subCommands: {
      ui: defineCommand({
        meta: { name: "ui", description: "Open the full OpenTUI workbench." },
        args: terminalArgs(),
        async run({ args }) {
          const raw = ["ui"]
          if (args.renderer) raw.push("--renderer", String(args.renderer))
          if (args.lang) raw.push("--lang", String(args.lang))
          if (args.theme) raw.push("--theme", String(args.theme))
          await runProgram(raw, host, dependencies)
        },
      }),
      gd: defineCommand({ meta: { name: "gd", description: "Open the compact guided flow." }, async run() { await runProgram(["gd"], host, dependencies) } }),
      guided: defineCommand({ meta: { name: "guided", description: "Compatibility alias for gd." }, async run() { await runProgram(["guided"], host, dependencies) } }),
      inspect: pipeCommand("inspect", "Inspect archive image entries without writing files.", host, dependencies),
      plan: pipeCommand("plan", "Plan native output paths without writing files.", host, dependencies),
      make: pipeCommand("make", "Convert archives; use --live to write output files.", host, dependencies),
    },
  })
}

function pipeCommand(action: GifuAction, description: string, host: CliHost, dependencies: GifuCliDependencies) {
  return defineCommand({
    meta: { name: action, description },
    args: pipeArgs(),
    async run({ args }) {
      const options = args as GifuCliOptions
      const json = Boolean(options.json)
      const defaults = await resolveGifuDefaults(host, json)
      let pathText = options.paths
      if (pathText === "-" || (!pathText && hasPipedInput(host.stdin))) pathText = (await readStdinLines(host.stdin)).join("\n")
      const input = inputFromCli(action, options, defaults, parsePathList(pathText ?? ""))
      const result = await runGifu(input, dependencies.createRuntime())
      if (json) writeJson(host, result)
      else writeLine(host, result.message)
      if (!result.success) process.exitCode = 1
    },
  })
}

async function resolveGifuDefaults(host: CliHost, json = false): Promise<GifuDefaults> {
  try {
    const { config } = await loadNodeConfigWithHints<GifuNodeConfig>("gifu", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const interaction = resolveInteractionPreferences(config)
    return {
      interactionMode: interaction.mode,
      interactionRenderer: interaction.renderer,
      interactionLanguage: interaction.language,
      interactionTheme: interaction.theme,
      pathsText: config?.paths?.join("\n"),
      recursive: config?.recursive,
      format: config?.format,
      outMode: config?.out_mode,
      outDir: config?.out_dir,
      namePrefix: config?.name_prefix,
      nameTemplate: config?.name_template,
      durationMs: config?.duration_ms,
      loop: config?.loop,
      quality: config?.quality,
      webpMethod: config?.webp_method,
      ffmpegThreads: config?.ffmpeg_threads,
      webmCrf: config?.webm_crf,
      webmCpuUsed: config?.webm_cpu_used,
      mp4Preset: config?.mp4_preset,
      mp4Cq: config?.mp4_cq,
      maxWorkers: config?.max_workers,
      extractSingle: config?.extract_single,
      overwrite: config?.overwrite,
      dryRun: config?.dry_run,
      recordRun: config?.record_run,
      databasePath: config?.database_path,
      configPath: config?.legacy_config_path,
    }
  } catch {
    return {}
  }
}

function inputFromCli(action: GifuAction, args: GifuCliOptions, defaults: GifuDefaults, paths: string[]): GifuInput {
  return {
    action,
    paths: paths.length ? paths : parsePathList(defaults.pathsText ?? ""),
    listFile: args.listFile,
    configPath: args.config ?? defaults.configPath,
    recursive: args.noRecursive ? false : args.recursive ?? defaults.recursive,
    format: asFormat(args.format) ?? defaults.format,
    outDir: args.outDir ?? defaults.outDir,
    outMode: asOutMode(args.outMode) ?? defaults.outMode,
    namePrefix: args.namePrefix ?? defaults.namePrefix,
    nameTemplate: args.nameTemplate ?? defaults.nameTemplate,
    durationMs: numberArg(args.duration) ?? defaults.durationMs,
    loop: numberArg(args.loop) ?? defaults.loop,
    quality: numberArg(args.quality) ?? defaults.quality,
    webpMethod: numberArg(args.webpMethod) ?? defaults.webpMethod,
    ffmpegThreads: numberArg(args.ffmpegThreads) ?? defaults.ffmpegThreads,
    webmCrf: numberArg(args.webmCrf) ?? defaults.webmCrf,
    webmCpuUsed: numberArg(args.webmCpuUsed) ?? defaults.webmCpuUsed,
    mp4Preset: args.mp4Preset ?? defaults.mp4Preset,
    mp4Cq: numberArg(args.mp4Cq) ?? defaults.mp4Cq,
    maxWorkers: numberArg(args.maxWorkers) ?? defaults.maxWorkers,
    extractSingle: args.noExtractSingle ? false : args.extractSingle ?? defaults.extractSingle,
    overwrite: args.overwrite ?? defaults.overwrite,
    dryRun: action !== "make" ? true : args.live ? false : args.dryRun ?? defaults.dryRun ?? defaultGifuInput.dryRun,
    recordRun: args.recordRun ?? defaults.recordRun,
    databasePath: args.databasePath ?? defaults.databasePath,
  }
}

function pipeArgs() {
  return {
    paths: { type: "positional" as const, required: false, description: "Archive/folder paths; multiple values are accepted or use semicolons." },
    config: { type: "string" as const, description: "Legacy gifu TOML path." },
    listFile: { type: "string" as const, alias: "list-file", description: "Text file containing one path per line." },
    recursive: { type: "boolean" as const, description: "Scan directories recursively." },
    noRecursive: { type: "boolean" as const, alias: "no-recursive", description: "Do not recurse into directories." },
    format: { type: "string" as const, description: "gif, webp, apng, webm, mp4, or auto." },
    outDir: { type: "string" as const, alias: "out-dir", description: "Output directory." },
    outMode: { type: "string" as const, alias: "out-mode", description: "same or separate." },
    namePrefix: { type: "string" as const, alias: "name-prefix", description: "Output name prefix." },
    nameTemplate: { type: "string" as const, alias: "name-template", description: "Output name template." },
    duration: { type: "string" as const, description: "Frame duration in milliseconds." },
    loop: { type: "string" as const, description: "Loop count; 0 is infinite." },
    quality: { type: "string" as const, description: "WebP quality, 1-100." },
    webpMethod: { type: "string" as const, alias: "webp-method", description: "WebP effort, 0-6." },
    ffmpegThreads: { type: "string" as const, alias: "ffmpeg-threads", description: "FFmpeg threads; 0 is automatic." },
    webmCrf: { type: "string" as const, alias: "webm-crf", description: "WebM CRF, 0-63." },
    webmCpuUsed: { type: "string" as const, alias: "webm-cpu-used", description: "WebM cpu-used, 0-8." },
    mp4Preset: { type: "string" as const, alias: "mp4-preset", description: "MP4 NVENC preset p1-p7." },
    mp4Cq: { type: "string" as const, alias: "mp4-cq", description: "MP4 CQ, 0-63." },
    maxWorkers: { type: "string" as const, alias: "max-workers", description: "Parallel archives; 0 is automatic." },
    extractSingle: { type: "boolean" as const, alias: "extract-single", description: "Extract single-image archives." },
    noExtractSingle: { type: "boolean" as const, alias: "no-extract-single", description: "Skip single-image archives." },
    overwrite: { type: "boolean" as const, description: "Overwrite existing outputs." },
    dryRun: { type: "boolean" as const, alias: "dry-run", description: "Preview without writing files." },
    live: { type: "boolean" as const, description: "Allow make to write output files." },
    recordRun: { type: "boolean" as const, alias: "record-run", description: "Append a JSONL run record." },
    databasePath: { type: "string" as const, alias: "database-path", description: "JSONL run record path." },
    json: { type: "boolean" as const, description: "Print only JSON to stdout." },
  }
}

function terminalArgs() {
  return {
    renderer: { type: "string" as const, description: "opentui." },
    lang: { type: "string" as const, description: "zh or en." },
    theme: { type: "string" as const, description: "Terminal theme name." },
  }
}

const VALUE_FLAGS = new Set([
  "--config", "--list-file", "--format", "--out-dir", "--out-mode", "--name-prefix", "--name-template", "--duration", "--loop",
  "--quality", "--webp-method", "--ffmpeg-threads", "--webm-crf", "--webm-cpu-used", "--mp4-preset", "--mp4-cq", "--max-workers", "--database-path",
])

export function normalizeMultiplePaths(args: readonly string[]): string[] {
  if (!args.length || !["inspect", "plan", "make"].includes(args[0]!)) return [...args]
  const action = args[0]!
  const paths: string[] = []
  const flags: string[] = []
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index]!
    if (value.startsWith("-")) {
      flags.push(value)
      const flag = value.split("=", 1)[0]!
      if (!value.includes("=") && VALUE_FLAGS.has(flag) && args[index + 1] !== undefined) flags.push(args[++index]!)
    } else {
      paths.push(value)
    }
  }
  return [action, ...(paths.length ? [paths.join(";")] : []), ...flags]
}

function asFormat(value: string | undefined): GifuFormat | undefined {
  const normalized = value?.toLowerCase()
  return normalized === "gif" || normalized === "webp" || normalized === "wbp" || normalized === "apng" || normalized === "webm" || normalized === "mp4" || normalized === "auto" ? normalized : undefined
}

function asOutMode(value: string | undefined): GifuOutputMode | undefined {
  return value === "same" || value === "separate" ? value : undefined
}

function numberArg(value: string | undefined): number | undefined {
  const number = Number(value)
  return value !== undefined && Number.isFinite(number) ? number : undefined
}

function createDefaultHost(): CliHost {
  return { cwd: process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
}

if (process.argv[1] && /\bcli\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
