import type { ReaderInputActionExecutionContext } from "@xiranite/node-neoview/ui-core"

export interface ReaderFileEntryDeleteInvocation {
  kind: "file-entry-delete"
  targetPath: string
  confirmationHandled: true
}

export type ReaderInputInvocation = ReaderFileEntryDeleteInvocation

export type ReaderInputExecutionContext = ReaderInputActionExecutionContext & {
  invocation?: ReaderInputInvocation
}
