import type { FileMutation, FileOperationBatchResult, FileOperationRequest } from "./types.js"

export interface FileOperationExecutor {
  execute(request: FileOperationRequest): Promise<FileOperationBatchResult>
}

export async function executeSingleFileMutation(
  executor: FileOperationExecutor,
  operation: FileMutation,
): Promise<FileOperationBatchResult> {
  const batch = await executor.execute({ operations: [operation], concurrency: 1 })
  const result = batch.results[0]
  if (!result || result.status !== "succeeded") {
    throw Object.assign(new Error(result?.error ?? `File operation failed: ${operation.kind}`), {
      code: result?.errorCode ?? "FILE_OPERATION_FAILED",
      deletionId: result?.deletionId,
    })
  }
  return batch
}
