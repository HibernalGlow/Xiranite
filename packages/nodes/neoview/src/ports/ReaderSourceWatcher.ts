import type { ViewSource } from "../domain/book/book.js"
import type { ReaderFileTreeChangeKind } from "./ReaderFileTreeWatcher.js"

export interface ReaderSourceChange {
  kind: ReaderFileTreeChangeKind
}

export interface ReaderSourceSubscription extends AsyncDisposable {
  close(): Promise<void>
}

export interface ReaderSourceWatcher {
  subscribe(
    source: ViewSource,
    onChanges: (changes: readonly ReaderSourceChange[]) => void,
    onError?: () => void,
  ): Promise<ReaderSourceSubscription>
}
