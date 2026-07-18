export type ReaderFileMutation =
  | { kind: "copy" | "move" | "rename"; sourcePath: string; destinationPath: string; overwrite?: boolean }
  | { kind: "delete" | "trash"; sourcePath: string }
  | { kind: "create-directory"; destinationPath: string }

export interface ReaderFileMutationGuard {
  path: string
  kind: "file" | "directory" | "symbolic-link" | "other"
  size: number
  mtimeMs: number
  ctimeMs: number
  device: number
  inode: number
}

export interface ReaderFileUndoReceipt {
  original: ReaderFileMutation
  inverse: ReaderFileMutation
  guard: ReaderFileMutationGuard
  providerData?: {
    kind: "windows-recycle-bin"
    itemPath: string
  }
}

export interface ReaderFileMutationProvider {
  /** True when trash operations can be restored to their original paths. */
  readonly trashRestore?: boolean
  execute(operation: ReaderFileMutation, signal?: AbortSignal): Promise<ReaderFileUndoReceipt | undefined | void>
  undo?(receipt: ReaderFileUndoReceipt, signal?: AbortSignal): Promise<void>
}
