import type { NodeClipboardCapability, NodeLocalFilesCapability } from "@xiranite/contract"
import type { XlchemyData, XlchemyFormat, XlchemyOutputMode } from "@xiranite/node-xlchemy/core"

export type XlchemyClipboardCopyMode = "file" | "image"
export type ClipboardImageData = { base64: string; mimeType: string }

export interface ClipboardConversionResult {
  copiedMode?: XlchemyClipboardCopyMode
  data: XlchemyData
  format: XlchemyFormat
  output: ClipboardImageData
  outputMode: XlchemyOutputMode
  quality: number
}

export async function copyClipboardConversion(
  result: ClipboardConversionResult,
  mode: XlchemyClipboardCopyMode,
  clipboard: NodeClipboardCapability | undefined,
  localFiles: NodeLocalFilesCapability | undefined,
): Promise<void> {
  if (mode === "image") {
    if (!clipboard?.writeImage) throw new Error("当前宿主不支持写入剪贴板图片。")
    await clipboard.writeImage(result.output)
    return
  }

  if (!clipboard?.writeFiles) throw new Error("当前宿主不支持写入文件剪贴板。")
  const persistentOutputPath = result.outputMode === "directory"
    ? result.data.files.find((file) => file.status === "converted")?.outputPath
    : undefined

  let outputPath = persistentOutputPath
  if (!outputPath) {
    if (!localFiles?.stageFiles) throw new Error("当前宿主不支持暂存剪贴板输出文件。")
    const file = encodedOutputFile(result.output)
    outputPath = (await localFiles.stageFiles([file]))[0]
    if (!outputPath) throw new Error("暂存剪贴板输出文件失败。")
  }
  await clipboard.writeFiles([outputPath])
}

export function clipboardCopyModeLabel(mode: XlchemyClipboardCopyMode): string {
  return mode === "file" ? "文件" : "兼容图片"
}

function encodedOutputFile(output: ClipboardImageData): File {
  const binary = atob(output.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], `xlchemy-clipboard${extensionForMime(output.mimeType)}`, { type: output.mimeType })
}

function extensionForMime(mimeType: string): string {
  const extension = MIME_EXTENSIONS[mimeType.toLowerCase()]
  if (!extension) throw new Error(`无法将 ${mimeType} 作为文件复制。`)
  return extension
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/jpeg": ".jpg",
  "image/jxl": ".jxl",
  "image/png": ".png",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
}
