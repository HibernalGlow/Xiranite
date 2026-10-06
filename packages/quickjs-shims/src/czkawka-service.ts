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
 *
 * The trash family at the bottom of this file is **not** a czkawka scan method: it is the host's `trash`
 * service (`service.invoke { service: "trash" }`), which `@xiranite/file-operations` reaches through these
 * same names. See the note there before changing either half.
 */
import { notImplemented } from "./internal.ts"
import { opServiceInvoke, opServiceInvokeAsync } from "./ops.ts"
import { SHIM_ERROR_CODES, QuickJsShimError } from "./host.ts"

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
/**
 * The recycle bin: a second host service behind the same door.
 *
 * These four names are **not** czkawka scan methods. `packages/czkawka-native` happened to carry the native
 * trash backend alongside the duplicate engine, so `@xiranite/file-operations` imports them from there
 * (`packages/file-operations/src/platform.ts:3-11`, a consumer named by name in
 * `docs/xiranite-target-node-manifest.json`'s `hostServicesPreserved`, which is why the `czkawka` node's
 * removal kept the capability). Inside a realm the alias lands on this file, so the trash half is served by
 * the host's own `trash` service — `crates/xiranite-quickjs-executor/src/trash_operations.rs`, which publishes
 * `info | move | list | restore | purge` over `xiranite_core::trash_service` (ADR-0064).
 *
 * `getTrashCapabilities` answers a document instead of throwing because its caller cannot absorb a refusal:
 * `PlatformFileMutationProvider`'s constructor calls it synchronously, and only to decide whether `restore`
 * and `list` get wired (`platform.ts:49-51`). Letting it throw would stop a node doing a plain copy or rename
 * because the bin is not granted. The two booleans going false is the honest answer in that case — and the
 * way to make them true is the node's `services` grant in the target manifest, not a softer shim.
 */

/** Mirrors `packages/czkawka-native/generated/binding.generated.d.ts:256-270` so both faces type one shape. */
export interface TrashCapabilities {
  deleteToTrash: boolean
  list: boolean
  restore: boolean
  provider: string
  providerVersion: string
}

export interface TrashItemReceipt {
  id: string
  name: string
  originalParent: string
  timeDeleted: number
}

export interface TrashPathResult {
  trashed: boolean
  receipt?: TrashItemReceipt
}

/** `trash.info`'s support document (`trash_operations.rs:57-69`); `inventoryScope` is `system-bin` | `own-journal`. */
interface TrashInfoAnswer {
  service: string
  backend: string
  canTrash: boolean
  canInventory: boolean
  inventoryScope: string
}

/** `trash.list` (`trash_operations.rs:119-138`): `items` is null exactly when `supported` is false. */
interface TrashListAnswer {
  supported: boolean
  backend: string
  scope?: string
  items?: Array<{ id: string; name: string; originalParent: string; deletedUnixSecs: number; sizeBytes?: number }> | null
  error?: string
}

export function getTrashCapabilities(): TrashCapabilities {
  let info: TrashInfoAnswer
  try {
    info = opServiceInvoke("trash", "info", {}) as TrashInfoAnswer
  } catch {
    // Ungranted (`service.invoke` refuses a node that declared no `trash` service) or a host that carries no
    // bin: everything false, so the provider wires neither restore nor list and says so by backend name.
    return { deleteToTrash: false, list: false, restore: false, provider: "none", providerVersion: "" }
  }
  return {
    deleteToTrash: info.canTrash === true,
    // The host publishes one boolean for `list`/`restore`/`purge` together, at the scope `inventoryScope` names.
    list: info.canInventory === true,
    restore: info.canInventory === true,
    provider: info.backend,
    // `trash_service.rs:71-84`'s support document carries no version field, and the only consumer in this repo
    // reads the two booleans, so this stays empty rather than carrying a substituted meaning.
    providerVersion: "",
  }
}

/**
 * One path to the bin, through the run's granted filesystem (`trash.move`).
 *
 * The host answers `{ trashed, paths }` and **no receipt** (`trash_operations.rs:110-117`), so a realm
 * deletion cannot hand `PlatformFileMutationProvider` the item id its undo path prefers
 * (`platform.ts:156-157`): without a receipt that provider records no undo for the deletion at all. Fixing
 * that is a host change — make `trash.move` answer the item it moved — and is deliberately not faked here by
 * guessing an id from `list`, which would pick another deletion when two share a name.
 */
export async function trashPath(path: string): Promise<TrashPathResult> {
  const answer = (await opServiceInvokeAsync("trash", "move", { path })) as { trashed?: boolean }
  return { trashed: answer.trashed === true }
}

/** The bin's items at the scope the host names — never an empty list when the platform cannot inventory. */
export async function listTrashItems(): Promise<TrashItemReceipt[]> {
  const answer = (await opServiceInvokeAsync("trash", "list", {})) as TrashListAnswer
  if (answer.supported !== true || answer.items == null) {
    throw new QuickJsShimError(
      SHIM_ERROR_CODES.memberUnsupported,
      `quickjs-shim: czkawka-native.listTrashItems has no inventory to read on the host trash backend ${JSON.stringify(answer.backend)}.`,
      { module: "czkawka-native", member: "listTrashItems", backend: answer.backend, scope: answer.scope, error: answer.error },
    )
  }
  return answer.items.map((item) => ({
    id: item.id,
    name: item.name,
    originalParent: item.originalParent,
    timeDeleted: item.deletedUnixSecs,
  }))
}

/** Put one listed item back, by the id `listTrashItems` handed out (`trash.restore` takes `{ id }`). */
export async function restoreTrashItem(receipt: TrashItemReceipt): Promise<void> {
  await opServiceInvokeAsync("trash", "restore", { id: receipt.id })
}
