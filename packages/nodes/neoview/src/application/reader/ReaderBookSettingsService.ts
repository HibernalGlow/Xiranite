import { z } from "zod"

import type {
  ReaderBookSettingsOverrides,
  ReaderBookSettingsRecord,
  ReaderBookSettingsStore,
} from "../../ports/ReaderBookSettingsStore.js"

export const ReaderBookSettingsPatchSchema = z.object({
  favorite: z.boolean().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  direction: z.enum(["left-to-right", "right-to-left"]).nullable().optional(),
  pageMode: z.enum(["single", "double"]).nullable().optional(),
  horizontalBook: z.boolean().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Book settings patch must not be empty.")

export type ReaderBookSettingsPatch = z.infer<typeof ReaderBookSettingsPatchSchema>

export interface ReaderBookSettingsDefaults {
  favorite: boolean
  rating: number
  direction: "left-to-right" | "right-to-left"
  pageMode: "single" | "double"
  horizontalBook: boolean
}

export interface ReaderBookSettingsSnapshot {
  schemaVersion: 1
  bookId: string
  revision: number
  updatedAt?: number
  overrides: ReaderBookSettingsOverrides
  effective: ReaderBookSettingsDefaults
  inherited: Array<keyof ReaderBookSettingsOverrides>
}

export class ReaderBookSettingsRevisionConflict extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Book settings revision conflict: expected ${expectedRevision}, current ${actualRevision}.`)
    this.name = "ReaderBookSettingsRevisionConflict"
  }
}

export class ReaderBookSettingsService {
  readonly #queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly store: ReaderBookSettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  async read(bookId: string, defaults: ReaderBookSettingsDefaults, signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot> {
    assertBookId(bookId)
    signal?.throwIfAborted()
    const record = await this.store.getBookSettings(bookId)
    signal?.throwIfAborted()
    return snapshot(bookId, record, defaults)
  }

  async update(
    bookId: string,
    expectedRevision: number,
    input: unknown,
    defaults: ReaderBookSettingsDefaults,
    applyFrame: (effective: Pick<ReaderBookSettingsDefaults, "direction" | "pageMode" | "horizontalBook">, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ReaderBookSettingsSnapshot> {
    assertBookId(bookId)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError("Book settings expectedRevision must be a non-negative integer.")
    }
    const patch = ReaderBookSettingsPatchSchema.parse(input)
    const previous = this.#queues.get(bookId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      signal?.throwIfAborted()
      const current = await this.store.getBookSettings(bookId)
      const actualRevision = current?.revision ?? 0
      if (actualRevision !== expectedRevision) throw new ReaderBookSettingsRevisionConflict(expectedRevision, actualRevision)
      const nextOverrides = mergeOverrides(current?.overrides ?? {}, patch)
      const previousEffective = resolveEffective(current?.overrides ?? {}, defaults)
      const nextEffective = resolveEffective(nextOverrides, defaults)
      let rollbackEffective = previousEffective
      const frameChanged = previousEffective.direction !== nextEffective.direction
        || previousEffective.pageMode !== nextEffective.pageMode
        || previousEffective.horizontalBook !== nextEffective.horizontalBook
      let frameApplied = false
      try {
        if (frameChanged) {
          await applyFrame(frameOptions(nextEffective), signal)
          frameApplied = true
        }
        signal?.throwIfAborted()
        const saved = await this.store.saveBookSettings(bookId, nextOverrides, expectedRevision, this.now())
        if (!saved) {
          const latest = await this.store.getBookSettings(bookId)
          rollbackEffective = resolveEffective(latest?.overrides ?? {}, defaults)
          throw new ReaderBookSettingsRevisionConflict(expectedRevision, latest?.revision ?? 0)
        }
        return snapshot(bookId, saved, defaults)
      } catch (error) {
        if (frameApplied) {
          try {
            await applyFrame(frameOptions(rollbackEffective))
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Book settings update failed and the active frame rollback was incomplete.")
          }
        }
        throw error
      }
    })
    this.#queues.set(bookId, operation)
    void operation.finally(() => {
      if (this.#queues.get(bookId) === operation) this.#queues.delete(bookId)
    }).catch(() => undefined)
    return operation
  }
}

function mergeOverrides(current: ReaderBookSettingsOverrides, patch: ReaderBookSettingsPatch): ReaderBookSettingsOverrides {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch) as Array<[keyof ReaderBookSettingsOverrides, ReaderBookSettingsOverrides[keyof ReaderBookSettingsOverrides] | null]>) {
    if (value === null) delete next[key]
    else Object.assign(next, { [key]: value })
  }
  return next
}

function snapshot(
  bookId: string,
  record: ReaderBookSettingsRecord | undefined,
  defaults: ReaderBookSettingsDefaults,
): ReaderBookSettingsSnapshot {
  const overrides = record?.overrides ?? {}
  const keys: Array<keyof ReaderBookSettingsOverrides> = ["favorite", "rating", "direction", "pageMode", "horizontalBook"]
  return {
    schemaVersion: 1,
    bookId,
    revision: record?.revision ?? 0,
    updatedAt: record?.updatedAt,
    overrides,
    effective: resolveEffective(overrides, defaults),
    inherited: keys.filter((key) => overrides[key] === undefined),
  }
}

function resolveEffective(overrides: ReaderBookSettingsOverrides, defaults: ReaderBookSettingsDefaults): ReaderBookSettingsDefaults {
  return {
    favorite: overrides.favorite ?? defaults.favorite,
    rating: overrides.rating ?? defaults.rating,
    direction: overrides.direction ?? defaults.direction,
    pageMode: overrides.pageMode ?? defaults.pageMode,
    horizontalBook: overrides.horizontalBook ?? defaults.horizontalBook,
  }
}

function frameOptions(effective: ReaderBookSettingsDefaults): Pick<ReaderBookSettingsDefaults, "direction" | "pageMode" | "horizontalBook"> {
  return { direction: effective.direction, pageMode: effective.pageMode, horizontalBook: effective.horizontalBook }
}

function assertBookId(bookId: string): void {
  if (!bookId || bookId.length > 2_048 || bookId.includes("\0")) throw new Error("Book settings bookId is invalid.")
}
