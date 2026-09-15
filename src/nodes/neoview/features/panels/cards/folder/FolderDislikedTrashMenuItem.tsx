import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import type { DirectoryScoresResult } from "@xiranite/node-clipm/contracts"
import { Ban, LoaderCircle, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useContextMenu } from "@/components/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { externalNode } from "@/nodes/shared/externalNodeGateway"

import type {
  ReaderDirectorySelectionOperationSnapshotDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import type { ReaderSwitchToastPort } from "../../../switch-toast/ReaderSwitchToastStore"
import type { DirectoryCatalog } from "./DirectoryCatalog"
import {
  collectFolderDislikedTrashTargets,
  type FolderDirectoryScore,
} from "./FolderDislikedTrash"
import { FOLDER_CLIPM_ENABLED } from "./folderClipmFeature"

const PAGE_SIZE = 128
const clipm = externalNode("clipm")

export function useFolderDislikedTrashMenuItem({
  catalog,
  client,
  disabled,
  switchToast,
  onCompleted,
  getDirectoryScores = requestDirectoryScores,
}: {
  catalog?: DirectoryCatalog
  client: ReaderHttpClient
  disabled: boolean
  switchToast?: ReaderSwitchToastPort
  onCompleted(): void | Promise<void>
  getDirectoryScores?(paths: readonly string[]): Promise<readonly FolderDirectoryScore[]>
}) {
  const contextMenu = useContextMenu()
  const completedRef = useRef(onCompleted)
  completedRef.current = onCompleted
  const [scanning, setScanning] = useState(false)
  const [operation, setOperation] = useState<ReaderDirectorySelectionOperationSnapshotDto>()

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
          await completedRef.current()
          showResult(snapshot, switchToast)
        } else if (snapshot.status === "cancelled") {
          switchToast?.show({ title: `已取消；已处理 ${snapshot.processed} / ${snapshot.total} 项。` })
        } else {
          switchToast?.show({ title: snapshot.error ?? "批量回收站操作失败。" })
        }
      } catch (cause) {
        if (!controller.signal.aborted) switchToast?.show({ title: errorMessage(cause) })
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timeout) clearTimeout(timeout)
    }
  }, [client.directorySelectionOperation, operation?.id, switchToast])

  const running = operation?.status === "running"
  const unavailable = disabled
    || scanning
    || !catalog
    || !contextMenu
    || !client.startDirectorySelectionOperation
    || !client.directorySelectionOperation

  async function prepareTrash(): Promise<void> {
    if (!catalog || unavailable || running) return
    setScanning(true)
    try {
      const targets = await collectFolderDislikedTrashTargets({
        catalog,
        pageSize: PAGE_SIZE,
        loadPage: async (cursor, limit) => {
          if (!client.listDirectoryBrowser) throw new Error("当前环境无法读取完整目录。")
          return client.listDirectoryBrowser(catalog.sessionId, cursor, limit)
        },
        getDirectoryScores,
      })
      if (!targets.total) {
        switchToast?.show({ title: "当前目录没有评分为 N 的文件或文件夹。" })
        return
      }
      void contextMenu?.confirm({
        id: "neoview-folder-trash-disliked",
        label: `将 ${targets.total} 个 N 项移到回收站`,
        icon: <Trash2 />,
        destructive: true,
        confirm: {
          title: `将 ${targets.total} 个 N 项移到回收站？`,
          description: `${targets.fileCount} 个文件、${targets.directoryCount} 个文件夹。文件夹的 N 来自内部最高 CM 评分；确认后会移动整个文件夹。操作可从回收站恢复。`,
          confirmLabel: "移到回收站",
          cancelLabel: "取消",
          destructive: true,
        },
        onSelect: () => { void startTrash(targets.selection) },
      })
    } catch (cause) {
      switchToast?.show({ title: errorMessage(cause) })
    } finally {
      setScanning(false)
    }
  }

  async function startTrash(selection: Parameters<NonNullable<ReaderHttpClient["startDirectorySelectionOperation"]>>[1]): Promise<void> {
    if (!catalog || !client.startDirectorySelectionOperation) return
    try {
      const snapshot = await client.startDirectorySelectionOperation(catalog.sessionId, selection, "trash")
      setOperation(snapshot)
      if (snapshot.status === "completed") {
        await completedRef.current()
        showResult(snapshot, switchToast)
      } else if (snapshot.status === "failed") {
        switchToast?.show({ title: snapshot.error ?? "批量回收站操作失败。" })
      }
    } catch (cause) {
      switchToast?.show({ title: errorMessage(cause) })
    }
  }

  async function cancelTrash(): Promise<void> {
    if (!operation || !client.cancelDirectorySelectionOperation) return
    try {
      setOperation(await client.cancelDirectorySelectionOperation(operation.id))
    } catch (cause) {
      switchToast?.show({ title: errorMessage(cause) })
    }
  }

  // ClipM 临时屏蔽：「N 项」判定完全依赖 clipm 节点评分，整个菜单项下线（见 folderClipmFeature.ts）。
  return !FOLDER_CLIPM_ENABLED ? null : (
    <DropdownMenuItem
      disabled={running ? !client.cancelDirectorySelectionOperation : unavailable}
      onSelect={() => { void (running ? cancelTrash() : prepareTrash()) }}
      data-folder-trash-disliked="true"
    >
      {scanning
        ? <LoaderCircle className="size-4 animate-spin" />
        : running
          ? <Ban className="size-4" />
          : <Trash2 className="size-4" />}
      {scanning
        ? "正在查找评分为 N 的项目..."
        : running
          ? `取消删除 N 项（${operation.processed} / ${operation.total}）`
          : "将评分为 N 的项目移到回收站"}
    </DropdownMenuItem>
  )
}

async function requestDirectoryScores(paths: readonly string[]): Promise<readonly FolderDirectoryScore[]> {
  const input: ClipmInput = { action: "directory-scores-get", directoryPaths: [...paths] }
  const result = await clipm.run<ClipmInput, ClipmData>(input)
  if (!result.success || !result.data || result.data.action !== "directory-scores-get") {
    throw new Error(result.message || "ClipM 未返回文件夹评分。")
  }
  return (result.data.result as DirectoryScoresResult).directories
}

function showResult(snapshot: ReaderDirectorySelectionOperationSnapshotDto, switchToast?: ReaderSwitchToastPort): void {
  switchToast?.show({
    title: snapshot.failed > 0
      ? `已将 ${snapshot.succeeded} 个 N 项移到回收站，${snapshot.failed} 项失败。`
      : `已将 ${snapshot.succeeded} 个 N 项移到回收站。`,
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
