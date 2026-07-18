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
}

export interface ReaderFileMutationProvider {
  execute(operation: ReaderFileMutation, signal?: AbortSignal): Promise<ReaderFileUndoReceipt | undefined | void>
  undo?(receipt: ReaderFileUndoReceipt, signal?: AbortSignal): Promise<void>
}
