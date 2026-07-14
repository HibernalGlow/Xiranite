export interface PageByteRange {
  start: number
  end: number
}

export interface PageSource extends AsyncDisposable {
  readonly byteLength?: number
  readonly contentType?: string
  readonly rangeSupported: boolean
  open(signal?: AbortSignal, range?: PageByteRange): Promise<ReadableStream<Uint8Array>>
  close(): Promise<void>
}

export interface PageContent {
  load(signal?: AbortSignal): Promise<PageSource>
}
