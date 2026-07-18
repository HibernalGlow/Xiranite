import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type AudiovAction = "status" | "plan" | "run"

export interface AudiovInput {
  action?: AudiovAction
  paths?: string[]
  /** Keep media writes opt-in. A dry run still produces the exact ffmpeg plan. */
  dryRun?: boolean
}

export interface AudiovCommandPlan {
  label: string
  command: string
  args: string[]
  inputPath: string
  outputPath: string
}

export interface AudiovCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface AudiovData {
  command?: AudiovCommandPlan
  commands: AudiovCommandPlan[]
  commandResults: AudiovCommandResult[]
  selectedPaths: string[]
  outputPaths: string[]
  errors: string[]
  ffmpegPath?: string
}

export interface AudiovRuntime {
  findFfmpeg: () => Promise<string | null>
  runCommand: (plan: AudiovCommandPlan) => Promise<AudiovCommandResult>
}

export type AudiovResult = NodeRunResult<AudiovData>

export const AUDIOV_DEFAULTS = {
  audioCodec: "aac",
  audioBitrate: "192k",
  outputSuffix: ".audio.m4a",
} as const

export function parseAudiovPaths(paths: string[] | undefined): string[] {
  return (paths ?? []).map((path) => path.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
}

export function createAudiovPlan(paths: string[], ffmpegPath = "ffmpeg"): AudiovCommandPlan[] {
  return paths.map((inputPath) => {
    const outputPath = deriveAudioOutputPath(inputPath)
    return {
      label: `Extract audio: ${fileName(inputPath)}`,
      command: ffmpegPath,
      args: [
        "-n",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        AUDIOV_DEFAULTS.audioCodec,
        "-b:a",
        AUDIOV_DEFAULTS.audioBitrate,
        outputPath,
      ],
      inputPath,
      outputPath,
    }
  })
}

/**
 * Native AudioV runner. It deliberately owns a fixed AAC/m4a extraction
 * profile instead of passing opaque Python or ffmpeg arguments through the UI.
 */
export async function runAudiov(
  input: AudiovInput,
  runtime: AudiovRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<AudiovResult> {
  const action = input.action ?? "status"
  const paths = parseAudiovPaths(input.paths)

  if (action === "status") {
    const ffmpegPath = await runtime.findFfmpeg()
    const data = emptyData({ ffmpegPath: ffmpegPath ?? undefined })
    if (!ffmpegPath) {
      return { success: false, message: "ffmpeg was not found on this system.", data }
    }
    return { success: true, message: `ffmpeg is ready: ${ffmpegPath}`, data }
  }

  if (!paths.length) {
    return { success: false, message: "Provide at least one video file path.", data: emptyData() }
  }

  const discoveredFfmpeg = action === "run" && !input.dryRun ? await runtime.findFfmpeg() : null
  if (action === "run" && !input.dryRun && !discoveredFfmpeg) {
    return { success: false, message: "ffmpeg was not found on this system.", data: emptyData({ selectedPaths: paths }) }
  }

  const commands = createAudiovPlan(paths, discoveredFfmpeg ?? "ffmpeg")
  const baseData: AudiovData = {
    command: commands[0],
    commands,
    commandResults: [],
    selectedPaths: paths,
    outputPaths: commands.map((command) => command.outputPath),
    errors: [],
    ffmpegPath: discoveredFfmpeg ?? undefined,
  }

  if (action === "plan" || input.dryRun) {
    onEvent({ type: "progress", progress: 100, message: `Planned ${commands.length} audio extraction task(s).` })
    return {
      success: true,
      message: `Planned ${commands.length} audio extraction task(s); no files were written.`,
      data: baseData,
    }
  }

  const commandResults: AudiovCommandResult[] = []
  const errors: string[] = []
  const outputPaths: string[] = []
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!
    const startProgress = Math.round((index / commands.length) * 90)
    onEvent({ type: "progress", progress: startProgress, message: `Extracting audio from ${fileName(command.inputPath)}.` })
    const result = await runtime.runCommand(command)
    commandResults.push(result)
    if (result.code === 0) {
      outputPaths.push(command.outputPath)
      continue
    }
    errors.push(shortError(result, command))
  }

  const success = errors.length === 0
  onEvent({ type: "progress", progress: 100, message: success ? "Audio extraction completed." : "Audio extraction finished with errors." })
  return {
    success,
    message: success
      ? `Extracted ${outputPaths.length} audio track(s).`
      : `Extracted ${outputPaths.length} audio track(s); ${errors.length} task(s) failed.`,
    data: { ...baseData, commandResults, outputPaths, errors },
  }
}

export function deriveAudioOutputPath(inputPath: string): string {
  const slash = Math.max(inputPath.lastIndexOf("/"), inputPath.lastIndexOf("\\"))
  const directory = slash >= 0 ? inputPath.slice(0, slash + 1) : ""
  const filename = slash >= 0 ? inputPath.slice(slash + 1) : inputPath
  const extensionIndex = filename.lastIndexOf(".")
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename
  return `${directory}${stem}${AUDIOV_DEFAULTS.outputSuffix}`
}

function emptyData(overrides: Partial<AudiovData> = {}): AudiovData {
  return {
    commands: [],
    commandResults: [],
    selectedPaths: [],
    outputPaths: [],
    errors: [],
    ...overrides,
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function shortError(result: AudiovCommandResult, command: AudiovCommandPlan): string {
  const message = (result.stderr || result.stdout || `ffmpeg exited with code ${result.code}`).trim()
  return `${fileName(command.inputPath)}: ${message.length > 360 ? `${message.slice(0, 357)}...` : message}`
}
