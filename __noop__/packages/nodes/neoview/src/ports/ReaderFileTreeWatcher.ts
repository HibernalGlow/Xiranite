export type ReaderFileTreeChangeKind = "create" | "update" | "delete"

export interface ReaderFileTreeChange {
  path: string
  kind: ReaderFileTreeChangeKind
}

export interface ReaderFileTreeSubscription extends AsyncDisposable {
  close(): Promise<void>
}

export interface ReaderFileTreeWatcher {
  subscribe(
    rootPath: string,
    onChanges: (changes: readonly ReaderFileTreeChange[]) => void,
    onError?: (error: Error) => void,
  ): Promise<ReaderFileTreeSubscription>
}
