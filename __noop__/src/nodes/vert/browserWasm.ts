export interface VertBrowserOutput { name: string; blob: Blob; converter: "ffmpeg" | "magick" | "pandoc" }

export async function convertFilesWithWasm(): Promise<VertBrowserOutput[]> {
  throw new Error("VERT 浏览器 Wasm 暂时关闭，请使用本地 CLI 转换。")
}

export function downloadBrowserOutput(output: VertBrowserOutput): void {
  const url = URL.createObjectURL(output.blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = output.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
