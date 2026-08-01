import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import type { FeedbackApplyResult, WorkScoreLookupResult, WorkScoreResult } from "@xiranite/node-clipm/contracts"
import { parseClipmFilenameScore, type ClipmFilenameScore } from "@xiranite/node-clipm/filename"
import { lazy, Suspense, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react"

import { externalNode } from "@/nodes/shared/externalNodeGateway"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { replaceDirectoryCatalogEntry, type DirectoryCatalog } from "./DirectoryCatalog"
import { replaceDirectorySelectionPath, type DirectorySelectionModel } from "./DirectorySelection"
import { sameFolderPath } from "./FolderPathIdentity"
import type { FolderClipmContextValue } from "./FolderClipmContext"
import type { FolderClipmDialogWork } from "./FolderClipmDialog"
import { predictFolderClipmPath, projectFolderClipmEntry } from "./FolderClipmProjection"

const FolderClipmDialog = lazy(() => import("./FolderClipmDialog"))
const clipm = externalNode("clipm")

interface FolderClipmDialogState {
  entry: ReaderDirectoryEntryDto
  work?: FolderClipmDialogWork
  loading: boolean
  error?: string
}

export interface FolderClipmControllerOptions {
  catalogRef: RefObject<DirectoryCatalog | undefined>
  setFocusedPath: Dispatch<SetStateAction<string | undefined>>
  setSelection: Dispatch<SetStateAction<DirectorySelectionModel>>
  commitCatalog(catalog: DirectoryCatalog): void
  refreshThumbnails(paths: ReadonlySet<string>): Promise<void>
  onSourcePathRelocated?(sourcePath: string, destinationPath: string): void
  onSourcePathRelocationCommitted?(sourcePath: string, destinationPath: string): Promise<void>
  setError(message: string | undefined): void
  invokeClipm?(input: ClipmInput): Promise<ClipmData>
}

export function useFolderClipmController(options: FolderClipmControllerOptions) {
  const [dialog, setDialog] = useState<FolderClipmDialogState>()
  const [pendingPath, setPendingPath] = useState<string>()
  const requestRef = useRef(0)

  async function openWork(entry: ReaderDirectoryEntryDto): Promise<void> {
    const requestId = ++requestRef.current
    const portableWork = portableDialogWork(entry)
    options.setError(undefined)
    setPendingPath(entry.path)
    setDialog({ entry, work: portableWork, loading: !portableWork })
    try {
      const invoke = options.invokeClipm ?? runClipmNode
      const lookup = await runWorkLookup({ action: "work-get", path: entry.path }, invoke)
      const work = lookup.work
        ?? await runWorkScore({ action: "score", scope: "work", path: entry.path }, invoke)
      if (requestId !== requestRef.current) return
      const projected = replaceEntryPath(entry, work.path)
      setPendingPath(projected.path)
      setDialog({ entry: projected, work, loading: false })
      await commitRelocation(entry.path, projected.path)
      await options.refreshThumbnails(new Set([projected.path]))
    } catch (cause) {
      if (requestId !== requestRef.current) return
      const message = errorMessage(cause)
      setDialog({ entry, work: portableWork, loading: false, error: message })
      options.setError(`ClipM：${message}`)
    } finally {
      if (requestId === requestRef.current) setPendingPath(undefined)
    }
  }

  async function saveFeedback(label: "P" | "N", score: number): Promise<void> {
    const current = dialog
    if (!current?.work?.workId) return
    const requestId = ++requestRef.current
    options.setError(undefined)
    const previousEntry = current.entry
    const optimisticPath = predictFolderClipmPath(previousEntry, {
      bundleVersion: current.work.bundleVersion,
      label,
      score,
      shortCode: current.work.shortCode,
    })
    const optimisticEntry = replaceEntryPath(previousEntry, optimisticPath)
    setPendingPath(optimisticEntry.path)
    setDialog({ ...current, entry: optimisticEntry, error: undefined })
    let work: WorkScoreResult
    try {
      work = await runFeedback({
        action: "feedback-apply",
        workId: current.work.workId,
        classification: label,
        ranking: score,
        source: "neoview",
      }, options.invokeClipm ?? runClipmNode)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      replaceEntry(optimisticEntry.path, previousEntry)
      const message = errorMessage(cause)
      setDialog({ ...current, entry: previousEntry, error: message })
      options.setError(`ClipM：${message}`)
      setPendingPath(undefined)
      return
    }
    if (requestId !== requestRef.current) return
    const committedEntry = replaceEntryPath(optimisticEntry, work.path)
    setDialog({ entry: committedEntry, work, loading: false })
    await commitRelocation(previousEntry.path, committedEntry.path)
    try {
      await options.refreshThumbnails(new Set([committedEntry.path]))
    } catch (cause) {
      options.setError(`ClipM：${errorMessage(cause)}`)
    } finally {
      if (requestId === requestRef.current) setPendingPath(undefined)
    }
  }

  async function commitRelocation(sourcePath: string, destinationPath: string): Promise<void> {
    if (sameFolderPath(sourcePath, destinationPath) || !options.onSourcePathRelocationCommitted) return
    try {
      await options.onSourcePathRelocationCommitted(sourcePath, destinationPath)
    } catch (cause) {
      options.setError(`ClipM：评分已保存，但 NeoView 路径记录同步失败：${errorMessage(cause)}`)
    }
  }

  function replaceEntryPath(entry: ReaderDirectoryEntryDto, destinationPath: string): ReaderDirectoryEntryDto {
    if (sameFolderPath(entry.path, destinationPath)) return entry
    const replacement = projectFolderClipmEntry(entry, destinationPath)
    replaceEntry(entry.path, replacement)
    return replacement
  }

  function replaceEntry(sourcePath: string, replacement: ReaderDirectoryEntryDto): void {
    const current = options.catalogRef.current
    if (current) {
      const next = replaceDirectoryCatalogEntry(current, sourcePath, replacement)
      if (next !== current) options.commitCatalog(next)
    }
    options.setSelection((selection) => replaceDirectorySelectionPath(selection, sourcePath, replacement.path))
    options.setFocusedPath((focusedPath) => focusedPath && sameFolderPath(focusedPath, sourcePath) ? replacement.path : focusedPath)
    if (!sameFolderPath(sourcePath, replacement.path)) options.onSourcePathRelocated?.(sourcePath, replacement.path)
  }

  const context: FolderClipmContextValue = {
    openWork: (entry) => { void openWork(entry) },
    pendingPath,
  }

  return {
    context,
    dialog: dialog ? (
      <Suspense fallback={null}>
        <FolderClipmDialog
          open
          name={dialog.entry.name}
          work={dialog.work}
          loading={dialog.loading}
          error={dialog.error}
          onClose={() => {
            requestRef.current += 1
            setPendingPath(undefined)
            setDialog(undefined)
          }}
          onSave={saveFeedback}
        />
      </Suspense>
    ) : null,
  }
}

function portableDialogWork(entry: ReaderDirectoryEntryDto): FolderClipmDialogWork | undefined {
  const score = parseClipmFilenameScore(entry.name)
  if (!score?.shortCode || score.version > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return workFromPortableScore(entry.path, score)
}

function workFromPortableScore(path: string, score: ClipmFilenameScore): FolderClipmDialogWork {
  return {
    path,
    label: score.label,
    score: score.score,
    bundleVersion: Number(score.version),
    shortCode: score.shortCode!,
    metadataWriteStatus: "skipped",
    renamed: false,
    stale: false,
  }
}

async function runWorkScore(input: ClipmInput, invoke: (input: ClipmInput) => Promise<ClipmData>): Promise<WorkScoreResult> {
  const data = await invoke(input)
  if (data.action !== "score" || "discoveredWorkCount" in data.result) throw new Error("ClipM 未返回单本评分。")
  return data.result as WorkScoreResult
}

async function runWorkLookup(input: ClipmInput, invoke: (input: ClipmInput) => Promise<ClipmData>): Promise<WorkScoreLookupResult> {
  const data = await invoke(input)
  if (data.action !== "work-get" || !("work" in data.result)) throw new Error("ClipM did not return a work lookup result.")
  return data.result as WorkScoreLookupResult
}

async function runFeedback(input: ClipmInput, invoke: (input: ClipmInput) => Promise<ClipmData>): Promise<WorkScoreResult> {
  const data = await invoke(input)
  if (data.action !== "feedback-apply" || !("work" in data.result)) throw new Error("ClipM 未返回修正结果。")
  return (data.result as FeedbackApplyResult).work
}

async function runClipmNode(input: ClipmInput): Promise<ClipmData> {
  const result = await clipm.run<ClipmInput, ClipmData>(input)
  if (!result.success || !result.data) throw new Error(result.message || "ClipM 调用失败。")
  return result.data
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
