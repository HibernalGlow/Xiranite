import pMap from "p-map"
import { z } from "zod"

import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"
import type { ReaderDirectoryMetadataField } from "../../ports/ReaderDirectoryMetadataProvider.js"
import { legacyEmmBookPathKey } from "./LegacyEmmBookMetadataCodec.js"
import {
  ReaderEmmMetadataPatchSchema,
  ReaderEmmMetadataRevisionConflict,
  type ReaderEmmMetadataService,
  type ReaderEmmMetadataSnapshot,
} from "./ReaderEmmMetadataService.js"

const MAX_UPDATES = 64
const MAX_CONCURRENCY = 8
const REFRESH_FIELDS = new Set<ReaderDirectoryMetadataField>(["rating", "collectTagCount", "tags"])

export const ReaderDirectoryEmmEditCommandSchema = z.object({
  generation: z.number().int().nonnegative(),
  updates: z.array(z.object({
    path: z.string().trim().min(1).max(32_768).refine((path) => !path.includes("\0"), "path contains NUL"),
    expectedRevision: z.number().int().nonnegative(),
    patch: ReaderEmmMetadataPatchSchema,
  }).strict()).min(1).max(MAX_UPDATES),
  concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
}).strict().superRefine((value, context) => {
  const paths = new Set<string>()
  for (const [index, update] of value.updates.entries()) {
    const key = normalizePath(update.path)
    if (paths.has(key)) context.addIssue({ code: "custom", path: ["updates", index, "path"], message: "duplicate path" })
    paths.add(key)
  }
})

export type ReaderDirectoryEmmEditCommand = z.infer<typeof ReaderDirectoryEmmEditCommandSchema>

export interface ReaderDirectoryEmmEditScope {
  resolveEntries(
    sessionId: string,
    generation: number,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[] | undefined>
  refreshEntryMetadata(
    sessionId: string,
    generation: number,
    paths: readonly string[],
    fields: ReadonlySet<ReaderDirectoryMetadataField>,
    signal?: AbortSignal,
  ): Promise<number | undefined>
}

export type ReaderDirectoryEmmEditResultItem =
  | { index: number; status: "succeeded"; metadata: ReaderEmmMetadataSnapshot }
  | { index: number; status: "conflict"; actualRevision: number }
  | { index: number; status: "failed"; error: string }

export interface ReaderDirectoryEmmEditResult {
  generation: number | null
  refreshRequired: boolean
  results: readonly ReaderDirectoryEmmEditResultItem[]
  succeeded: number
  conflicts: number
  failed: number
}

export class ReaderDirectoryEmmEditSessionNotFound extends Error {
  constructor() {
    super("Reader browser session not found.")
    this.name = "ReaderDirectoryEmmEditSessionNotFound"
  }
}

export class ReaderDirectoryEmmEditService {
  constructor(
    private readonly metadata: ReaderEmmMetadataService,
    private readonly scope: ReaderDirectoryEmmEditScope,
  ) {}

  async update(
    sessionId: string,
    command: ReaderDirectoryEmmEditCommand,
    signal?: AbortSignal,
  ): Promise<ReaderDirectoryEmmEditResult> {
    const input = ReaderDirectoryEmmEditCommandSchema.parse(command)
    signal?.throwIfAborted()
    const entries = await this.scope.resolveEntries(sessionId, input.generation, input.updates.map((item) => item.path), signal)
    if (!entries) throw new ReaderDirectoryEmmEditSessionNotFound()

    const results = await pMap(input.updates, async (update, index): Promise<ReaderDirectoryEmmEditResultItem> => {
      signal?.throwIfAborted()
      const path = entries[index]!.path
      try {
        const metadata = await this.metadata.update(
          legacyEmmBookPathKey(path),
          update.expectedRevision,
          update.patch,
          signal,
        )
        return { index, status: "succeeded", metadata }
      } catch (error) {
        if (signal?.aborted) throw error
        if (error instanceof ReaderEmmMetadataRevisionConflict) {
          return { index, status: "conflict", actualRevision: error.actualRevision }
        }
        return { index, status: "failed", error: error instanceof Error ? error.message : String(error) }
      }
    }, { concurrency: input.concurrency ?? 4 })

    const succeededPaths = results.flatMap((result) => result.status === "succeeded" ? [entries[result.index]!.path] : [])
    let generation: number | null = input.generation
    let refreshRequired = false
    if (succeededPaths.length) {
      try {
        generation = await this.scope.refreshEntryMetadata(
          sessionId,
          input.generation,
          succeededPaths,
          REFRESH_FIELDS,
          signal,
        ) ?? null
        refreshRequired = generation === null
      } catch (error) {
        if (signal?.aborted) throw error
        generation = null
        refreshRequired = true
      }
    }
    return {
      generation,
      refreshRequired,
      results,
      succeeded: results.filter((result) => result.status === "succeeded").length,
      conflicts: results.filter((result) => result.status === "conflict").length,
      failed: results.filter((result) => result.status === "failed").length,
    }
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}
