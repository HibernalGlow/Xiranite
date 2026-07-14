import { chooseConverter, normalizeFormat } from "@xiranite/node-vert/core"
import magickWasmUrl from "@imagemagick/magick-wasm/magick.wasm?url"
import pandocWasmUrl from "../../../ref/VERT/static/pandoc.wasm?url"

export interface VertBrowserOutput { name: string; blob: Blob; converter: "ffmpeg" | "magick" | "pandoc" }

let magickReady: Promise<typeof import("@imagemagick/magick-wasm")> | undefined
export async function convertFilesWithWasm(files: File[], targetFormat: string, quality = 90, onProgress: (progress: number, message: string) => void = () => {}): Promise<VertBrowserOutput[]> {
  const target = normalizeFormat(targetFormat)
  const outputs: VertBrowserOutput[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!
    const converter = chooseConverter(file.name, target)
    onProgress(Math.round((index / files.length) * 90), `${file.name} · ${converter} Wasm`)
    const blob = converter === "magick" ? await convertImage(file, target, quality) : converter === "ffmpeg" ? await convertMedia(file, target, (value) => onProgress(Math.round(((index + value) / files.length) * 90), `${file.name} · ffmpeg Wasm`)) : await convertDocument(file, target)
    outputs.push({ name: outputName(file.name, target), blob, converter })
  }
  onProgress(100, `Wasm converted ${outputs.length} file(s).`)
  return outputs
}

export function downloadBrowserOutput(output: VertBrowserOutput): void {
  const url = URL.createObjectURL(output.blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = output.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

async function convertImage(file: File, target: string, quality: number): Promise<Blob> {
  const magick = await (magickReady ??= initializeMagick())
  const input = new Uint8Array(await file.arrayBuffer())
  const source = extension(file.name)
  const readable = source === "jfif" ? "JPEG" : source === "fit" ? "FITS" : source.toUpperCase()
  const writable = target === "jfif" ? "JPEG" : target.toUpperCase()
  const image = magick.MagickImage.create(input, new magick.MagickReadSettings({ format: readable as typeof magick.MagickFormat[keyof typeof magick.MagickFormat] }))
  try {
    image.quality = Math.max(1, Math.min(100, Math.round(quality)))
    const bytes = await new Promise<Uint8Array>((resolve) => image.write(writable as typeof magick.MagickFormat[keyof typeof magick.MagickFormat], (output) => resolve(structuredClone(output))))
    return new Blob([new Uint8Array(bytes)], { type: mime(target) })
  } finally { image.dispose() }
}

async function initializeMagick() {
  const magick = await import("@imagemagick/magick-wasm")
  const response = await fetch(magickWasmUrl)
  if (!response.ok) throw new Error(`ImageMagick Wasm load failed: ${response.status}`)
  await magick.initializeImageMagick(new Uint8Array(await response.arrayBuffer()))
  return magick
}

async function convertMedia(file: File, target: string, onProgress: (value: number) => void): Promise<Blob> {
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")])
  const ffmpeg = new FFmpeg()
  ffmpeg.on("progress", ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))))
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm"
  await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm") })
  const inputName = `input.${extension(file.name) || "bin"}`
  const outputName = `output.${target}`
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    const code = await ffmpeg.exec(["-i", inputName, outputName])
    if (code !== 0) throw new Error(`ffmpeg Wasm exited with code ${code}`)
    const output = await ffmpeg.readFile(outputName)
    if (typeof output === "string") throw new Error("ffmpeg returned text instead of file data")
    return new Blob([new Uint8Array(output)], { type: mime(target) })
  } finally { ffmpeg.terminate() }
}

async function convertDocument(file: File, target: string): Promise<Blob> {
  const worker = new Worker(new URL("./pandoc.worker.ts", import.meta.url), { type: "module" })
  try {
    const [wasm, input] = await Promise.all([fetch(pandocWasmUrl).then((response) => response.arrayBuffer()), file.arrayBuffer()])
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ output?: ArrayBuffer; error?: string }>) => event.data.error ? reject(new Error(event.data.error)) : event.data.output ? resolve(event.data.output) : reject(new Error("Pandoc Wasm returned no output"))
      worker.onerror = (event) => reject(new Error(event.message))
      worker.postMessage({ wasm, input, inputName: file.name, target }, [wasm, input])
    })
    return new Blob([result], { type: mime(target) })
  } finally { worker.terminate() }
}

function outputName(name: string, target: string): string { const dot = name.lastIndexOf("."); return `${dot > 0 ? name.slice(0, dot) : name}.${target}` }
function extension(name: string): string { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : "" }
function mime(format: string): string { if (["png", "jpeg", "jpg", "webp", "gif", "svg", "avif"].includes(format)) return `image/${format === "jpg" ? "jpeg" : format}`; if (["mp3", "wav", "ogg", "flac", "m4a"].includes(format)) return `audio/${format}`; if (["mp4", "webm", "mov"].includes(format)) return `video/${format}`; return "application/octet-stream" }
