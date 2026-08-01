import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import type { FeedbackApplyResult, WorkScoreResult } from "@xiranite/node-clipm/contracts"
import { lazy, Suspense, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react"

import { externalNode } from "@/nodes/shared/externalNodeGateway"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { replaceDirectoryCatalogEntry, type DirectoryCatalog } from "./DirectoryCatalog"
import { replaceDirectorySelectionPath, type DirectorySelectionModel } from "./DirectorySelection"
import { sameFolderPath } from "./FolderPathIdentity"
import type { FolderClipmContextValue } from "./FolderClipmContext"
import { predictFolderClipmPath, projectFolderClipmEntry } from "./FolderClipmProjection"

const FolderClipmDialog = lazy(() => import("./FolderClipmDialog"))
const clipm = externalNode("clipm")

interface FolderClipmDialogState {
  entry: ReaderDirectoryEntryDto
  work?: WorkScoreResult
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
  setError(message: string | undefined): void
  invokeClipm?(input: ClipmInput): Promise<ClipmData>
}

export function useFolderClipmController(options: FolderClipmControllerOptions) {
  const [dialog, setDialog] = useState<FolderClipmDialogState>()
  const [pendingPath, setPendingPath] = useState<string>()
  const requestRef = useRef(0)

  async function openWork(entry: ReaderDirectoryEntryDto): Promise<void> {
    const requestId = ++requestRef.current
    options.setError(undefined)
    setPendingPath(entry.path)
    setDialog({ entry, loading: true })
    try {
      const work = await runWorkScore({ action: "score", scope: "work", path: entry.path }, options.invokeClipm ?? runClipmNode)
      if (requestId !== requestRef.current) return
      const projected = replaceEntryPath(entry, work.path)
      setPendingPath(projected.path)
      setDialog({ entry: projected, work, loading: false })
      await options.refreshThumbnails(new Set([projected.path]))
    } catch (cause) {
      if (requestId !== requestRef.current) return
      const message = errorMessage(cause)
      setDialog({ entry, loading: false, error: message })
      options.setError(`ClipM：${message}`)
    } finally {
      if (requestId === requestRef.current) setPendingPath(undefined)
    }
  }

  async function saveFeedback(label: "P" | "N", score: number): Promise<void> {
    const current = dialog
    if (!current?.work) return
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
    try {
      const work = await runFeedback({
        action: "feedback-apply",
        workId: current.work.workId,
        classification: label,
        ranking: score,
        source: "neoview",
      }, options.invokeClipm ?? runClipmNode)
      if (requestId !== requestRef.current) return
      const committedEntry = replaceEntryPath(optimisticEntry, work.path)
      setDialog({ entry: committedEntry, work, loading: false })
      await options.refreshThumbnails(new Set([committedEntry.path]))
    } catch (cause) {
      if (requestId !== requestRef.current) return
      replaceEntry(optimisticEntry.path, previousEntry)
      const message = errorMessage(cause)
      setDialog({ ...current, entry: previousEntry, error: message })
      options.setError(`ClipM：${message}`)
    } finally {
      if (requestId === requestRef.current) setPendingPath(undefined)
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

async function runWorkScore(input: ClipmInput, invoke: (input: ClipmInput) => Promise<ClipmData>): Promise<WorkScoreResult> {
  const data = await invoke(input)
  if (data.action !== "score" || "discoveredWorkCount" in data.result) throw new Error("ClipM 未返回单本评分。")
  return data.result as WorkScoreResult
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
