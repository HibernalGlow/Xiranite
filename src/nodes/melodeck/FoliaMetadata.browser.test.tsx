import { expect, test } from "vitest"

import { parseRemoteEmbeddedMetadataAsync } from "@hibernalglow/folia-player"

test("parses local audio metadata in Folia's worker without blocking the app thread", async () => {
  const url = URL.createObjectURL(createSilentWaveFile())
  try {
    const heartbeat = new Promise<number>((resolve) => requestAnimationFrame(resolve))
    const metadataPromise = parseRemoteEmbeddedMetadataAsync(url, { filePath: "silent.wav" })

    await expect(heartbeat).resolves.toEqual(expect.any(Number))
    await expect(metadataPromise).resolves.toMatchObject({ duration: expect.any(Number) })
  } finally {
    URL.revokeObjectURL(url)
  }
})

test("cancels stale metadata work when track selection changes", async () => {
  const controller = new AbortController()
  controller.abort()

  await expect(parseRemoteEmbeddedMetadataAsync("http://127.0.0.1/unused.flac", {
    filePath: "unused.flac",
    signal: controller.signal,
  })).resolves.toBeNull()
})

function createSilentWaveFile(): Blob {
  const sampleRate = 8_000
  const sampleCount = 800
  const dataSize = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, "WAVEfmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataSize, true)
  return new Blob([buffer], { type: "audio/wav" })
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}
