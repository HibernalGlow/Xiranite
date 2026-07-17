import type { ReaderSubtitleFormat } from "../domain/subtitle/subtitle.js"

export interface ReaderSubtitleConverter {
  convertToWebVtt(source: Uint8Array, format: ReaderSubtitleFormat, signal?: AbortSignal): Promise<Uint8Array>
}

export type ReaderSubtitleConverterLoader = () => Promise<ReaderSubtitleConverter>
