import { chooseConverter, createFfmpegArgs, normalizeFormat, withFfmpegCoverArt } from "@xiranite/node-vert/core"
import magickWasmUrl from "@imagemagick/magick-wasm/magick.wasm?url"
const pandocWasmUrl = "/wasm/pandoc.wasm"
import { makeZip } from "client-zip"
import type { IMagickImage } from "@imagemagick/magick-wasm"

export interface VertBrowserOutput { name: string; blob: Blob; converter: "ffmpeg" | "magick" | "pandoc" }

let magickReady: Promise<typeof import("@imagemagick/magick-wasm")> | undefined
export async function convertFilesWithWasm(files: File[], targetFormat: string, quality = 90, onProgress: (progress: number, message: string) => void = () => {}): Promise<VertBrowserOutput[]> {
  const target = normalizeFormat(targetFormat)
  const outputs: VertBrowserOutput[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!
    const converter = chooseConverter(file.name, target)
    onProgress(Math.round((index / files.length) * 90), `${file.name} · ${converter} Wasm`)
    if (converter === "pandoc") {
      const result = await convertDocument(file, target)
      outputs.push({ name: outputName(file.name, result.isZip ? "zip" : target), blob: result.blob, converter })
    } else if (converter === "magick") {
      const result = await convertImage(file, target, quality)
      outputs.push({ name: outputName(file.name, result.isZip ? "zip" : target), blob: result.blob, converter })
    } else {
      const mediaTarget = target === "alac" ? "m4a" : target
      const blob = await convertMedia(file, target, mediaTarget, (value) => onProgress(Math.round(((index + value) / files.length) * 90), `${file.name} · ffmpeg Wasm`))
      outputs.push({ name: outputName(file.name, mediaTarget), blob, converter })
    }
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

async function convertImage(file: File, target: string, quality: number): Promise<{ blob: Blob; isZip: boolean }> {
  const source = extension(file.name)
  if (source === "ani" || source === "icns") throw new Error(`.${source} 多帧解析需要使用本地 ImageMagick CLI`)
  if (source === "svg" && target === "svg") return { blob: file, isZip: false }
  const workingFile = source === "svg" && target !== "svg" ? await rasterizeSvg(file) : file
  if (source === "svg" && target === "png") return { blob: workingFile, isZip: false }
  const magick = await (magickReady ??= initializeMagick())
  const input = new Uint8Array(await workingFile.arrayBuffer())
  const workingSource = extension(workingFile.name)
  const readable = workingSource === "jfif" ? "JPEG" : workingSource === "fit" ? "FITS" : workingSource.toUpperCase()
  const writable = target === "jfif" ? "JPEG" : target.toUpperCase()
  if (source === "ico") {
    const images: Uint8Array[] = []
    for (let frameIndex = 0; ; frameIndex += 1) {
      try {
        const image = magick.MagickImage.create(input, new magick.MagickReadSettings({ format: magick.MagickFormat.Ico, frameIndex }))
        try { images.push(await writeMagickImage(magick, image, writable, target, quality)) } finally { image.dispose() }
      } catch { break }
    }
    if (!images.length) throw new Error("ICO contains no readable images")
    const stream = makeZip(images.map((bytes, index) => new File([new Uint8Array(bytes)], `image${index}.${target}`)), "images.zip")
    return { blob: new Blob([await readStream(stream.getReader())], { type: "application/zip" }), isZip: true }
  }
  if ((source === "gif" || source === "webp") && (target === "gif" || target === "webp")) {
    const collection = magick.MagickImageCollection.create(input)
    try {
      const bytes = await new Promise<Uint8Array>((resolve) => collection.write(writable as typeof magick.MagickFormat[keyof typeof magick.MagickFormat], (output) => resolve(structuredClone(output))))
      return { blob: new Blob([new Uint8Array(bytes)], { type: mime(target) }), isZip: false }
    } finally { collection.dispose() }
  }
  const image = magick.MagickImage.create(input, new magick.MagickReadSettings({ format: readable as typeof magick.MagickFormat[keyof typeof magick.MagickFormat] }))
  try {
    const bytes = await writeMagickImage(magick, image, writable, target, quality)
    return { blob: new Blob([new Uint8Array(bytes)], { type: mime(target) }), isZip: false }
  } finally { image.dispose() }
}

async function rasterizeSvg(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = "async"
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("SVG rasterization failed")); image.src = url })
    const width = Math.max(1, image.naturalWidth || 1024)
    const height = Math.max(1, image.naturalHeight || 1024)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas 2D is unavailable")
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("SVG rasterization returned no image")), "image/png"))
    return new File([blob], `${file.name.replace(/\.svg$/i, "")}.png`, { type: "image/png" })
  } finally { URL.revokeObjectURL(url) }
}

async function writeMagickImage(magick: typeof import("@imagemagick/magick-wasm"), image: IMagickImage, writable: string, target: string, quality: number): Promise<Uint8Array> {
  image.quality = Math.max(1, Math.min(100, Math.round(quality)))
  if (target === "ico" && (image.width > 256 || image.height > 256)) { const scale = 256 / Math.max(image.width, image.height); image.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale))) }
  return new Promise<Uint8Array>((resolve) => image.write(writable as typeof magick.MagickFormat[keyof typeof magick.MagickFormat], (output) => resolve(structuredClone(output))))
}

async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> { const chunks: Uint8Array[] = []; while (true) { const part = await reader.read(); if (part.done) break; if (part.value) chunks.push(part.value) } const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length } return output }

async function initializeMagick() {
  const magick = await import("@imagemagick/magick-wasm")
  const response = await fetch(magickWasmUrl)
  if (!response.ok) throw new Error(`ImageMagick Wasm load failed: ${response.status}`)
  await magick.initializeImageMagick(new Uint8Array(await response.arrayBuffer()))
  return magick
}

async function convertMedia(file: File, target: string, outputExtension: string, onProgress: (value: number) => void): Promise<Blob> {
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")])
  const ffmpeg = new FFmpeg()
  ffmpeg.on("progress", ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))))
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm"
  await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm") })
  const inputName = `input.${extension(file.name) || "bin"}`
  const outputName = `output.${outputExtension}`
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    let args = createFfmpegArgs(inputName, outputName, true, target)
    if (args.includes("color=c=black:s=512x512:rate=1")) {
      const coverCode = await ffmpeg.exec(["-y", "-i", inputName, "-map", "0:v:0", "-frames:v", "1", "-update", "1", "cover.jpg"])
      if (coverCode === 0) args = withFfmpegCoverArt(args, "cover.jpg")
    }
    const code = await ffmpeg.exec(args)
    if (code !== 0) throw new Error(`ffmpeg Wasm exited with code ${code}`)
    const output = await ffmpeg.readFile(outputName)
    if (typeof output === "string") throw new Error("ffmpeg returned text instead of file data")
    return new Blob([new Uint8Array(output)], { type: mime(outputExtension) })
  } finally { ffmpeg.terminate() }
}

async function convertDocument(file: File, target: string): Promise<{ blob: Blob; isZip: boolean }> {
  const worker = new Worker(new URL("./pandoc.worker.ts", import.meta.url), { type: "module" })
  try {
    const [wasm, input] = await Promise.all([fetch(pandocWasmUrl).then((response) => response.arrayBuffer()), file.arrayBuffer()])
    const result = await new Promise<{ output: ArrayBuffer; isZip: boolean }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ output?: ArrayBuffer; isZip?: boolean; error?: string }>) => event.data.error ? reject(new Error(event.data.error)) : event.data.output ? resolve({ output: event.data.output, isZip: event.data.isZip ?? false }) : reject(new Error("Pandoc Wasm returned no output"))
      worker.onerror = (event) => reject(new Error(event.message))
      worker.postMessage({ wasm, input, inputName: file.name, target }, [wasm, input])
    })
    return { blob: new Blob([result.output], { type: result.isZip ? "application/zip" : mime(target) }), isZip: result.isZip }
  } finally { worker.terminate() }
}

function outputName(name: string, target: string): string { const dot = name.lastIndexOf("."); return `${dot > 0 ? name.slice(0, dot) : name}.${target}` }
function extension(name: string): string { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : "" }
function mime(format: string): string { if (["png", "jpeg", "jpg", "webp", "gif", "svg", "avif"].includes(format)) return `image/${format === "jpg" ? "jpeg" : format}`; if (["mp3", "wav", "ogg", "flac", "m4a"].includes(format)) return `audio/${format}`; if (["mp4", "webm", "mov"].includes(format)) return `video/${format}`; return "application/octet-stream" }
