import type { ReaderDirectoryEmmRecord, ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag, ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"
import type { ReaderEmmRatingCatalogRecord, ReaderEmmRatingCatalogStore } from "../../ports/ReaderEmmRatingCatalogStore.js"

export type ReaderEmmRecordCatalogStore = ReaderDirectoryEmmRecordStore & Partial<ReaderEmmTagCatalogStore & ReaderEmmRatingCatalogStore>

export function composeReaderEmmStores(primary: ReaderEmmRecordCatalogStore, fallback?: ReaderEmmRecordCatalogStore): ReaderDirectoryEmmRecordStore & ReaderEmmTagCatalogStore & Partial<ReaderEmmRatingCatalogStore> {
  return {
    directoryEmmAvailable: primary.directoryEmmAvailable || Boolean(fallback?.directoryEmmAvailable),
    async readDirectoryEmmRecords(paths, signal, options) {
      const [primaryRecords, fallbackRecords] = await Promise.all([
        primary.readDirectoryEmmRecords(paths, signal, options),
        fallback?.readDirectoryEmmRecords(paths, signal, options) ?? Promise.resolve(new Map<string, ReaderDirectoryEmmRecord>()),
      ])
      const output = new Map<string, ReaderDirectoryEmmRecord>()
      for (const path of paths) {
        const inherited = fallbackRecords.get(path)
        const current = primaryRecords.get(path)
        if (inherited || current) output.set(path, { ...inherited, ...current })
      }
      return output
    },
    async sampleEmmTags(count, signal) {
      const [primaryTags, fallbackTags] = await Promise.all([
        primary.sampleEmmTags?.(count, signal) ?? Promise.resolve([] as readonly ReaderEmmCatalogTag[]),
        fallback?.sampleEmmTags?.(count, signal) ?? Promise.resolve([] as readonly ReaderEmmCatalogTag[]),
      ])
      const output = new Map<string, ReaderEmmCatalogTag>()
      for (const tag of [...primaryTags, ...fallbackTags]) output.set(`${tag.category.toLocaleLowerCase()}\0${tag.tag.toLocaleLowerCase()}`, tag)
      return [...output.values()].slice(0, count)
    },
    ...(primary.listEmmRatingRecords || fallback?.listEmmRatingRecords ? {
      async listEmmRatingRecords(signal?: AbortSignal): Promise<readonly ReaderEmmRatingCatalogRecord[]> {
        const [primaryRecords, fallbackRecords] = await Promise.all([
          primary.listEmmRatingRecords?.(signal) ?? Promise.resolve([] as readonly ReaderEmmRatingCatalogRecord[]),
          fallback?.listEmmRatingRecords?.(signal) ?? Promise.resolve([] as readonly ReaderEmmRatingCatalogRecord[]),
        ])
        const output = new Map(fallbackRecords.map((record) => [record.path.replaceAll("\\", "/").toLocaleLowerCase(), record]))
        for (const record of primaryRecords) output.set(record.path.replaceAll("\\", "/").toLocaleLowerCase(), record)
        return [...output.values()]
      },
    } : {}),
  }
}
