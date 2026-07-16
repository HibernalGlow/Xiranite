export type ReaderFileMutation =
  | { kind: "copy" | "move" | "rename"; sourcePath: string; destinationPath: string; overwrite?: boolean }
  | { kind: "delete" | "trash"; sourcePath: string }
  | { kind: "create-directory"; destinationPath: string }

export interface ReaderFileMutationProvider {
  execute(operation: ReaderFileMutation, signal?: AbortSignal): Promise<void>
}
