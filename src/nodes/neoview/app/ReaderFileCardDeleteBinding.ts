import type { ReaderInputActionSequenceResult, ReaderInputDescriptor } from "@xiranite/node-neoview/ui-core"
import type { ReaderInputInvocation } from "../features/input/ReaderInputInvocation"

export type ReaderFileCardDeleteStrategy = "trash" | "delete"

export async function dispatchReaderFileCardDeleteBinding(
  sourcePath: string,
  strategy: ReaderFileCardDeleteStrategy,
  dispatch: (
    input: ReaderInputDescriptor,
    target: EventTarget | null,
    invocation?: ReaderInputInvocation,
  ) => Promise<ReaderInputActionSequenceResult | undefined>,
): Promise<ReaderInputActionSequenceResult | undefined> {
  const targetPath = sourcePath.trim()
  if (!targetPath) return undefined
  return await dispatch(
    { device: "command", command: strategy === "trash" ? "file-card.trash-current" : "file-card.delete-current" },
    null,
    { kind: "file-entry-delete", targetPath, confirmationHandled: true },
  )
}
