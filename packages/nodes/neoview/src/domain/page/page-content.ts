export interface PageSource extends AsyncDisposable {
  readonly byteLength?: number
  readonly contentType?: string
  open(signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
  close(): Promise<void>
}

export interface PageContent {
  load(signal?: AbortSignal): Promise<PageSource>
}
