import { randomInt } from "node:crypto"

import type { ReaderEmmCatalogTag, ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"

export interface ReaderEmmFavoriteTagSource {
  load(signal?: AbortSignal): Promise<{ tags: readonly ReaderEmmCatalogTag[] }>
}

export interface ReaderEmmTagTranslationSource {
  translate(tags: readonly ReaderEmmCatalogTag[], signal?: AbortSignal): Promise<ReadonlyMap<string, string>>
  key(tag: ReaderEmmCatalogTag): string
}

export interface ReaderEmmTagSuggestion extends ReaderEmmCatalogTag {
  favorite: boolean
  translatedTag?: string
}

export class ReaderEmmTagSuggestionService {
  constructor(
    private readonly catalog: ReaderEmmTagCatalogStore,
    private readonly favorites: ReaderEmmFavoriteTagSource,
    private readonly nextIndex: (maximum: number) => number = randomInt,
    private readonly translations?: ReaderEmmTagTranslationSource,
  ) {}

  async suggest(count = 8, signal?: AbortSignal): Promise<readonly ReaderEmmTagSuggestion[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 32) throw new RangeError("EMM tag suggestion count must be from 1 to 32.")
    signal?.throwIfAborted()
    const [catalogTags, favoriteSnapshot] = await Promise.all([
      this.catalog.sampleEmmTags(Math.min(64, count + 2), signal),
      this.favorites.load(signal).catch(() => ({ tags: [] })),
    ])
    signal?.throwIfAborted()
    const favoriteTags = sampleWithoutReplacement(dedupeTags(favoriteSnapshot.tags), Math.min(3, count), this.nextIndex)
    const favoriteKeys = new Set(favoriteTags.map(tagKey))
    const suggestions: ReaderEmmTagSuggestion[] = [
      ...favoriteTags.map((tag) => ({ ...tag, favorite: true })),
      ...dedupeTags(catalogTags).filter((tag) => !favoriteKeys.has(tagKey(tag))).map((tag) => ({ ...tag, favorite: false })),
    ].slice(0, count)
    const translations = await this.translations?.translate(suggestions, signal).catch(() => undefined)
    signal?.throwIfAborted()
    if (!translations?.size || !this.translations) return suggestions
    return suggestions.map((value) => ({
      ...value,
      translatedTag: translations.get(this.translations!.key(value)),
    }))
  }
}

function dedupeTags(tags: readonly ReaderEmmCatalogTag[]): ReaderEmmCatalogTag[] {
  const output = new Map<string, ReaderEmmCatalogTag>()
  for (const value of tags) {
    const category = value.category.trim()
    const tag = value.tag.trim()
    if (!category || !tag || category.length > 128 || tag.length > 256) continue
    const normalized = tagKey({ category, tag })
    if (!output.has(normalized)) output.set(normalized, { category, tag })
  }
  return [...output.values()]
}

function sampleWithoutReplacement<T>(values: readonly T[], count: number, nextIndex: (maximum: number) => number): T[] {
  const pool = [...values]
  const output: T[] = []
  while (output.length < count && pool.length) {
    const index = nextIndex(pool.length)
    if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length) throw new RangeError("Random tag sampler returned an invalid index.")
    output.push(pool[index]!)
    pool[index] = pool.at(-1)!
    pool.pop()
  }
  return output
}

function tagKey(value: ReaderEmmCatalogTag): string {
  return `${value.category.normalize("NFKC").toLocaleLowerCase()}\0${value.tag.normalize("NFKC").toLocaleLowerCase()}`
}
