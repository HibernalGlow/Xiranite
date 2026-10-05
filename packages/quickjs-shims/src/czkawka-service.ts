/**
 * `@xiranite/czkawka-native`, as the QuickJS realm sees it.
 *
 * The real package is a NAPI addon: `createRequire` + a `.node` file (
 * `packages/czkawka-native/src/index.ts:2`), which a QuickJS realm cannot load — that is `owithu`'s
 * blocker class, and it was the one part of the `czkawka` node that could not leave Node. The engine
 * it wrapped (crates.io `czkawka_core`, held by `native/czkawka-core`) is now linked into the host and
 * reached through `service.invoke`, so this module keeps the *same export names and shapes* the node's
 * `platform.ts` already codes against, and swaps how the answer arrives.
 *
 * ## Why the progress loop lives here, not in the node
 *
 * `platform.ts` is shared by both faces: Node/Bun (real `setInterval`) and the QuickJS bundle (no
 * timers at all — measured: none in `crates/xiranite-quickjs-executor`). A loop written in the node
 * would therefore run on one face and silently not on the other. So the node hands `platform.ts`'s
 * callbacks down to the binding, and each binding paces them with what its runtime actually has: the
 * addon polls with an interval, this module awaits the host's `scan.progress` long-poll.
 *
 * ## What is not here yet
 *
 * `scan.duplicates` and `scan.basic` (which covers the node's six flat-list tools) reach the engine. The
 * media, EXIF and video-optimizer families answer a refusal that names the service method which would
 * carry them — never an empty success, because a scan that reported no findings would read as "this
 * folder is clean".
 */
import { notImplemented } from "./internal.ts"
import { opServiceInvoke, opServiceInvokeAsync } from "./ops.ts"

const SERVICE = "czkawka"

/** The option documents are passed through to the host unchanged; the host owns their validation. */
export type DuplicateScanOptions = Record<string, unknown>
export type BasicScanOptions = Record<string, unknown>
export type ExifScanOptions = Record<string, unknown>
export type MediaScanOptions = Record<string, unknown>
export type VideoOptimizerScanOptions = Record<string, unknown>
export type VideoOptimizerCandidateOptions = Record<string, unknown>
export type ExifCandidateOptions = Record<string, unknown>

export interface DuplicateFile {
  path: string
  modifiedDate: number
  size: number
  hash: string
  isReference: boolean
}

export interface DuplicateGroup {
  files: DuplicateFile[]
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  messages: string
  stopped: boolean
}

export interface CzkawkaScanProgress {
  stage: string
  stageIndex: number
  stageCount: number
  entriesChecked: number
  entriesTotal: number
  bytesChecked: number
  bytesTotal: number
}

export interface CzkawkaInfo {
  apiVersion: number
  sourceVersion: string
  capabilities: string[]
}

/** The controls a face may attach to a scan: progress reporting and a cancel probe. */
export interface CzkawkaScanControls {
  onProgress?: (progress: CzkawkaScanProgress) => void
  shouldCancel?: () => boolean
}

interface ProgressAnswer {
  done: boolean
  progress: CzkawkaScanProgress | null
  result?: unknown
}

export function getCzkawkaInfo(): CzkawkaInfo {
  return opServiceInvoke<CzkawkaInfo>(SERVICE, "info", {})
}

/**
 * One duplicate scan: started on a host worker thread, then followed to its end by this loop.
 *
 * Each round awaits `scan.progress`, which blocks host-side until the engine reports something (or a
 * bounded wait expires). That is what makes the realm's lack of timers harmless: the wait belongs to
 * the host, and the host checks the operation's pause and cancel on the way in, so a cancelled
 * operation surfaces as a rejection here rather than as one more empty round.
 */
export async function scanDuplicateFiles(
  options: DuplicateScanOptions,
  controls?: CzkawkaScanControls,
): Promise<DuplicateScanResult> {
  return runHostScan<DuplicateScanResult>(options, controls, "scan.duplicates")
}

/**
 * The six flat-list tools (`big-files`, `empty-files`, `empty-folders`, `temporary-files`,
 * `invalid-symlinks`, `bad-names`): the engine's `BasicTool` is the same choice in different letters,
 * so one service method carries all six and `options.tool` selects between them.
 */
export async function scanBasicFiles(
  options: BasicScanOptions,
  controls?: CzkawkaScanControls,
): Promise<unknown> {
  return runHostScan(options, controls, "scan.basic")
}

async function runHostScan<T>(
  options: DuplicateScanOptions,
  controls: CzkawkaScanControls | undefined,
  method: string,
): Promise<T> {
  const scanId = String(options.scanId ?? "")
  if (!scanId) throw new Error(`quickjs-shim: ${method} needs a scanId in its options.`)
  await opServiceInvokeAsync<{ scanId: string; threads: number }>(SERVICE, method, options)

  let last = ""
  for (;;) {
    const answer = await opServiceInvokeAsync<ProgressAnswer>(SERVICE, "scan.progress", { scanId })
    const progress = answer.progress
    if (progress && controls?.onProgress) {
      const signature = `${progress.stage}:${progress.stageIndex}:${progress.entriesChecked}:${progress.bytesChecked}`
      if (signature !== last) {
        last = signature
        controls.onProgress(progress)
      }
    }
    if (answer.done) return answer.result as T
    if (controls?.shouldCancel?.()) await opServiceInvokeAsync(SERVICE, "scan.cancel", { scanId })
  }
}

/** Kept for call sites that hold the addon's API; the cancel now travels through the same service. */
export async function cancelCzkawkaScan(scanId: string): Promise<boolean> {
  const answer = await opServiceInvokeAsync<{ stopped: boolean }>(SERVICE, "scan.cancel", { scanId })
  return answer.stopped
}

/** One newest-progress read, without starting or waiting for anything. */
export async function getCzkawkaScanProgress(scanId: string): Promise<CzkawkaScanProgress | null> {
  const answer = await opServiceInvokeAsync<ProgressAnswer>(SERVICE, "scan.progress", { scanId, waitMs: 0 })
  return answer.progress
}

const refused = (member: string, method: string) =>
  notImplemented("czkawka-native", member, `service.invoke { service: "czkawka", method: "czkawka.${method}" }`)

export const scanExifFiles: (options: ExifScanOptions, controls?: CzkawkaScanControls) => Promise<unknown> =
  refused("scanExifFiles", "scan.exif")
export const scanMediaFiles: (options: MediaScanOptions, controls?: CzkawkaScanControls) => Promise<unknown> =
  refused("scanMediaFiles", "scan.media")
export const scanVideoOptimizer: (
  options: VideoOptimizerScanOptions,
  controls?: CzkawkaScanControls,
) => Promise<unknown> = refused("scanVideoOptimizer", "scan.video-optimizer")
export const createExifCandidate: (options: ExifCandidateOptions) => Promise<unknown> =
  refused("createExifCandidate", "exif.candidate")
export const createVideoOptimizerCandidate: (options: VideoOptimizerCandidateOptions) => Promise<unknown> =
  refused("createVideoOptimizerCandidate", "video-optimizer.candidate")
/** The recycle bin is a host service of its own (ADR-0064), not a czkawka scan method. */
export const trashPath: (path: string) => Promise<unknown> = refused("trashPath", "trash.path")
