import type { ReaderActivationTraversalFrameDto } from "../../../../adapters/reader-http-client"

/** Appends a user-selected child to the explicit inline-expansion stack. */
export function appendReaderActivationTraversalFrame(
  traversalRootPath: string,
  activatedEntryPath: string,
  parentFrames?: readonly ReaderActivationTraversalFrameDto[],
): readonly ReaderActivationTraversalFrameDto[] {
  const directoryPath = parentFrames?.at(-1)?.currentEntryPath ?? traversalRootPath
  return [
    ...(parentFrames?.map((frame) => ({ ...frame })) ?? []),
    { directoryPath, currentEntryPath: activatedEntryPath },
  ]
}
