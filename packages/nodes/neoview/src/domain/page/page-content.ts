export interface PageByteRange {
  start: number
  end: number
}

export interface PageSourceExecution {
  resourceLease?: { release(): void }
}

export interface PageSource extends AsyncDisposable {
  readonly byteLength?: number
  readonly contentType?: string
  readonly rangeSupported: boolean
  readonly transformResource?: "cpu" | "io" | "gpu"
  open(signal?: AbortSignal, range?: PageByteRange, execution?: PageSourceExecution): Promise<ReadableStream<Uint8Array>>
  close(): Promise<void>
}

export interface PageContent {
  load(signal?: AbortSignal): Promise<PageSource>
}
