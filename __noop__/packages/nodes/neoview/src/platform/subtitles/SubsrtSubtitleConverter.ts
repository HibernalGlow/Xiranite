import type { ReaderSubtitleFormat } from "../../domain/subtitle/subtitle.js"
import type { ReaderSubtitleConverter } from "../../ports/ReaderSubtitleConverter.js"

const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

export class SubsrtSubtitleConverter implements ReaderSubtitleConverter {
  async convertToWebVtt(source: Uint8Array, format: ReaderSubtitleFormat, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted()
    const content = decoder.decode(source)
    if (format === "vtt") {
      if (!/^\uFEFF?WEBVTT(?:[ \t]|\r?$)/m.test(content.slice(0, 128))) throw new Error("Invalid WebVTT subtitle header.")
      return source
    }
    const imported = await import("subsrt")
    signal?.throwIfAborted()
    const subsrt = imported.default
    const output = subsrt.convert(content, { from: format, to: "vtt" })
    signal?.throwIfAborted()
    if (!output.startsWith("WEBVTT")) throw new Error("Subtitle converter returned invalid WebVTT.")
    return encoder.encode(output)
  }
}
