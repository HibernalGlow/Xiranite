import { dirname } from "node:path"

import type { ReaderBookTraversalCursor, ReaderBookTraversalFrame } from "./ReaderHierarchicalBookTraversal.js"

export interface ReaderActivationIdentity {
  readerSourcePath: string
  activatedEntryPath: string
  traversalRootPath: string
  traversalFrames?: readonly ReaderBookTraversalFrame[]
  selfTerminal?: boolean
}

/** Keeps navigation context and the user-visible entry attached to one Reader source. */
export function resolveReaderActivationIdentity(
  readerSourcePath: string,
  cursor?: ReaderBookTraversalCursor,
): ReaderActivationIdentity {
  const frame = cursor?.frames.at(-1)
  return {
    readerSourcePath,
    activatedEntryPath: frame?.currentEntryPath ?? readerSourcePath,
    traversalRootPath: cursor?.rootPath ?? dirname(readerSourcePath),
    ...(cursor?.frames.length ? { traversalFrames: cursor.frames.map((candidate) => ({ ...candidate })) } : {}),
    ...(frame?.selfTerminal ? { selfTerminal: true } : {}),
  }
}
