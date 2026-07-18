import { z } from "zod"

import type {
  ReaderEmmOverrideRecord,
  ReaderEmmOverrides,
  ReaderEmmOverrideStore,
  ReaderEmmTag,
} from "../../ports/ReaderEmmOverrideStore.js"

const TagSchema = z.object({
  namespace: z.string().trim().min(1).max(128),
  tag: z.string().trim().min(1).max(256),
}).strict()

const OverridesSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  manualTags: z.array(TagSchema).max(256).optional(),
  translatedTitle: z.string().trim().min(1).max(1_024).optional(),
}).strict()

export const ReaderEmmMetadataPatchSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  manualTags: z.array(TagSchema).max(256).nullable().optional(),
  translatedTitle: z.string().trim().min(1).max(1_024).nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, "patch must change at least one field")

export const ReaderEmmMetadataSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  overrides: OverridesSchema,
  inherited: z.array(z.enum(["rating", "manualTags", "translatedTitle"])),
  updatedAt: z.number().int().nonnegative().optional(),
}).strict()

export type ReaderEmmMetadataSnapshot = z.infer<typeof ReaderEmmMetadataSnapshotSchema>

export type ReaderEmmMetadataPatch = z.infer<typeof ReaderEmmMetadataPatchSchema>

export class ReaderEmmMetadataRevisionConflict extends Error {
  constructor(readonly actualRevision: number) {
    super(`Reader EMM metadata revision conflict: expected another revision, actual ${actualRevision}.`)
    this.name = "ReaderEmmMetadataRevisionConflict"
  }
}

export class ReaderEmmMetadataService {
  readonly #queues = new Map<string, Promise<void>>()

  constructor(private readonly store: ReaderEmmOverrideStore) {}

  async read(path: string, signal?: AbortSignal): Promise<ReaderEmmMetadataSnapshot> {
    const identity = normalizePath(path)
    signal?.throwIfAborted()
    const record = await this.store.getEmmOverride(identity)
    signal?.throwIfAborted()
    return snapshot(record)
  }

  update(
    path: string,
    expectedRevision: number,
    patch: ReaderEmmMetadataPatch,
    signal?: AbortSignal,
  ): Promise<ReaderEmmMetadataSnapshot> {
    const identity = normalizePath(path)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Reader EMM metadata expectedRevision is invalid.")
    const parsed = ReaderEmmMetadataPatchSchema.parse(patch)
    if (!Object.keys(parsed).length) throw new Error("Reader EMM metadata patch must change at least one field.")
    return this.#serialize(identity, async () => {
      signal?.throwIfAborted()
      const current = await this.store.getEmmOverride(identity)
      const actualRevision = current?.revision ?? 0
      if (actualRevision !== expectedRevision) throw new ReaderEmmMetadataRevisionConflict(actualRevision)
      const overrides = applyPatch(current?.overrides ?? {}, parsed)
      const saved = await this.store.saveEmmOverride(identity, overrides, expectedRevision, Date.now())
      if (!saved) {
        const latest = await this.store.getEmmOverride(identity)
        throw new ReaderEmmMetadataRevisionConflict(latest?.revision ?? 0)
      }
      signal?.throwIfAborted()
      return snapshot(saved)
    })
  }

  #serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.#queues.set(key, settled)
    void settled.finally(() => { if (this.#queues.get(key) === settled) this.#queues.delete(key) })
    return result
  }
}

export function parseReaderEmmOverrides(value: unknown): ReaderEmmOverrides {
  const parsed = OverridesSchema.parse(value)
  return {
    ...parsed,
    manualTags: parsed.manualTags ? dedupeTags(parsed.manualTags) : undefined,
  }
}

function applyPatch(current: ReaderEmmOverrides, patch: ReaderEmmMetadataPatch): ReaderEmmOverrides {
  const next: ReaderEmmOverrides = { ...current }
  for (const key of ["rating", "manualTags", "translatedTitle"] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else if (key === "manualTags") next.manualTags = dedupeTags(value as ReaderEmmTag[])
    else Object.assign(next, { [key]: value })
  }
  return parseReaderEmmOverrides(next)
}

function dedupeTags(tags: readonly ReaderEmmTag[]): ReaderEmmTag[] {
  const output = new Map<string, ReaderEmmTag>()
  for (const value of tags) {
    const tag = TagSchema.parse(value)
    output.set(`${tag.namespace.toLocaleLowerCase()}\0${tag.tag.toLocaleLowerCase()}`, tag)
  }
  return [...output.values()]
}

function snapshot(record: ReaderEmmOverrideRecord | undefined): ReaderEmmMetadataSnapshot {
  const overrides = parseReaderEmmOverrides(record?.overrides ?? {})
  const inherited = (["rating", "manualTags", "translatedTitle"] as const).filter((key) => overrides[key] === undefined)
  return {
    revision: record?.revision ?? 0,
    overrides: {
      ...overrides,
      manualTags: overrides.manualTags ? [...overrides.manualTags] : undefined,
    },
    inherited,
    updatedAt: record?.updatedAt,
  }
}

function normalizePath(value: string): string {
  const path = value.trim()
  if (!path || path.length > 32_768 || path.includes("\0")) throw new Error("Reader EMM metadata path is invalid.")
  return path
}
