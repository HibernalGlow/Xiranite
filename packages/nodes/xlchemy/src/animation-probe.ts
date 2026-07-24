import { open, readFile } from "node:fs/promises"
import { extname } from "node:path"
import { isAnimatedAvif, isAnimatedPng } from "./container-animation.js"

export async function isAnimatedImage(path: string): Promise<boolean> {
  const extension = extname(path).toLowerCase()
  if (extension === ".png" || extension === ".apng") return isAnimatedPng(await readPrefix(path, 1024 * 1024))
  if (extension === ".avif") return isAnimatedAvif(await readPrefix(path, 4096))
  if (extension !== ".webp" && extension !== ".jxl") return false
  const { default: sharp } = await import("sharp")
  const pipeline = sharp(await readFile(path), { animated: true })
  try {
    const metadata = await pipeline.metadata()
    return (metadata.pages ?? 1) > 1
  } finally {
    pipeline.destroy()
  }
}

async function readPrefix(path: string, capacity: number): Promise<Uint8Array> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.allocUnsafe(capacity)
    const { bytesRead } = await handle.read(buffer, 0, capacity, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
