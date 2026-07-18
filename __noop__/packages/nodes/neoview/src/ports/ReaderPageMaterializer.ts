import type { ReaderPage } from "../domain/page/page.js"

export interface ReaderPageMaterializationLease extends AsyncDisposable {
  readonly path: string
  readonly byteLength: number
  release(): Promise<void>
}

export interface ReaderPageMaterializer {
  materialize(
    page: ReaderPage,
    options?: { signal?: AbortSignal; maxBytes?: number },
  ): Promise<ReaderPageMaterializationLease>
}
