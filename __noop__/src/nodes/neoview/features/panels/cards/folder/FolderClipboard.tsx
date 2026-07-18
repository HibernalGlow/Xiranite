import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import type {
  ReaderDirectoryClipboardSnapshotDto,
  ReaderDirectorySelectionDescriptorDto,
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"

interface FolderClipboardState {
  clipboard: ReaderDirectoryClipboardSnapshotDto
  operation?: ReaderDirectorySelectionOperationSnapshotDto
  lastCompleted?: ReaderDirectorySelectionOperationSnapshotDto
  feedback?: { kind: "status" | "alert"; text: string }
  prepare(sessionId: string, selection: ReaderDirectorySelectionDescriptorDto, mode: "copy" | "move"): Promise<void>
  paste(destinationPath: string): Promise<void>
  cancel(): Promise<void>
}

const EMPTY_CLIPBOARD: ReaderDirectoryClipboardSnapshotDto = { available: false }
const UNAVAILABLE_CLIPBOARD: FolderClipboardState = {
  clipboard: EMPTY_CLIPBOARD,
  prepare: async () => { throw new Error("Folder clipboard is unavailable.") },
  paste: async () => { throw new Error("Folder clipboard is unavailable.") },
  cancel: async () => undefined,
}
const FolderClipboardContext = createContext<FolderClipboardState>(UNAVAILABLE_CLIPBOARD)

export function FolderClipboardProvider({ client, children }: { client: ReaderHttpClient; children: ReactNode }) {
  const [clipboard, setClipboard] = useState<ReaderDirectoryClipboardSnapshotDto>(EMPTY_CLIPBOARD)
  const [operation, setOperation] = useState<ReaderDirectorySelectionOperationSnapshotDto>()
  const [lastCompleted, setLastCompleted] = useState<ReaderDirectorySelectionOperationSnapshotDto>()
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const loadGenerationRef = useRef(0)

  useEffect(() => {
    if (!client.directoryClipboard) return
    const controller = new AbortController()
    const generation = ++loadGenerationRef.current
    void client.directoryClipboard(controller.signal).then((snapshot) => {
      if (!controller.signal.aborted && generation === loadGenerationRef.current) setClipboard(snapshot)
    }).catch((error) => {
      if (!controller.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
    })
    return () => controller.abort()
  }, [client.directoryClipboard])

  useEffect(() => {
    const operationId = operation?.id
    if (!operationId || operation.status !== "running" || !client.directorySelectionOperation) return
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const snapshot = await client.directorySelectionOperation!(operationId, controller.signal)
        if (controller.signal.aborted) return
        setOperation(snapshot)
        if (snapshot.status === "running") {
          timeout = setTimeout(() => { void poll() }, 150)
          return
        }
        if (snapshot.status === "completed") {
          setLastCompleted(snapshot)
          setFeedback(snapshot.failed
            ? { kind: "alert", text: `${operationLabel(snapshot.kind)} ${snapshot.succeeded} 项，${snapshot.failed} 项失败。` }
            : { kind: "status", text: `${operationLabel(snapshot.kind)} ${snapshot.succeeded} 项。` })
        } else if (snapshot.status === "cancelled") {
          setFeedback({ kind: "status", text: `已取消；已处理 ${snapshot.processed} / ${snapshot.total} 项。` })
        } else {
          setFeedback({ kind: "alert", text: snapshot.error ?? "文件粘贴失败。" })
        }
      } catch (error) {
        if (!controller.signal.aborted) setFeedback({ kind: "alert", text: errorMessage(error) })
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timeout) clearTimeout(timeout)
    }
  }, [client.directorySelectionOperation, operation?.id])

  async function prepare(sessionId: string, selection: ReaderDirectorySelectionDescriptorDto, mode: "copy" | "move") {
    if (!client.prepareDirectoryClipboard) throw new Error("当前后端不支持文件剪贴板。")
    loadGenerationRef.current += 1
    setFeedback(undefined)
    try {
      const snapshot = await client.prepareDirectoryClipboard(sessionId, selection, mode)
      setClipboard(snapshot)
      setFeedback({ kind: "status", text: `${mode === "copy" ? "已复制" : "已剪切"} ${snapshot.available ? snapshot.total : 0} 项。` })
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
      throw error
    }
  }

  async function paste(destinationPath: string) {
    if (!client.pasteDirectoryClipboard || !clipboard.available) return
    setFeedback(undefined)
    try {
      const snapshot = await client.pasteDirectoryClipboard(destinationPath)
      setOperation(snapshot)
      if (clipboard.mode === "move") setClipboard(EMPTY_CLIPBOARD)
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
      throw error
    }
  }

  async function cancel() {
    if (!operation || operation.status !== "running" || !client.cancelDirectorySelectionOperation) return
    try {
      setOperation(await client.cancelDirectorySelectionOperation(operation.id))
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
    }
  }

  return (
    <FolderClipboardContext.Provider value={{ clipboard, operation, lastCompleted, feedback, prepare, paste, cancel }}>
      {children}
    </FolderClipboardContext.Provider>
  )
}

export function useFolderClipboard(): FolderClipboardState {
  return useContext(FolderClipboardContext)
}

function operationLabel(kind: ReaderDirectorySelectionOperationSnapshotDto["kind"]): string {
  if (kind === "copy") return "已复制"
  if (kind === "move") return "已移动"
  if (kind === "trash") return "已移到回收站"
  return "已删除"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
