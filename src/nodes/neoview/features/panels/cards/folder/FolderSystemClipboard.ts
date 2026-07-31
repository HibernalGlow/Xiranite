import type { NodeFileClipboardContents } from "@xiranite/contract"

import type { ReaderFileMutationDto } from "../../../../adapters/reader-http-client"

export const SYSTEM_CLIPBOARD_OPERATION_BATCH_SIZE = 256

export function systemClipboardPasteOperations(
  clipboard: NodeFileClipboardContents,
  destinationDirectory: string,
): ReaderFileMutationDto[] {
  return clipboard.paths.map((sourcePath) => ({
    kind: clipboard.effect,
    sourcePath,
    destinationPath: appendPath(destinationDirectory, clipboardPathName(sourcePath)),
  }))
}

export function clipboardPathName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/[\\/]+$/u, "")
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  const name = trimmed.slice(separator + 1)
  if (!name) throw new Error(`无法从剪贴板路径解析文件名：${sourcePath}`)
  return name
}

function appendPath(directory: string, name: string): string {
  if (!directory) throw new Error("粘贴目标目录不能为空。")
  if (directory.endsWith("/") || directory.endsWith("\\")) return `${directory}${name}`
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/"
  return `${directory}${separator}${name}`
}
