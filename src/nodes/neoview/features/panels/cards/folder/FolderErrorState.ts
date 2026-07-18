import { folderErrorMessage } from "./DirectoryCatalog"

export type FolderErrorOperation = "open" | "navigate" | "page" | "tree" | "search"

export interface FolderErrorState {
  operation: FolderErrorOperation
  message: string
  retryable: boolean
  retainLastGoodContent: boolean
}

export function createFolderErrorState(
  error: unknown,
  operation: FolderErrorOperation,
  options: { retryable?: boolean; retainLastGoodContent?: boolean } = {},
): FolderErrorState {
  return {
    operation,
    message: folderErrorMessage(error),
    retryable: options.retryable ?? true,
    retainLastGoodContent: options.retainLastGoodContent ?? operation !== "open",
  }
}

export function clearFolderErrorState(): undefined {
  return undefined
}

export function shouldRetainDirectoryContent(state: FolderErrorState | undefined): boolean {
  return state?.retainLastGoodContent === true
}
