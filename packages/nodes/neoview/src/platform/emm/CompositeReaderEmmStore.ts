import type { ReaderDirectoryEmmRecord, ReaderDirectoryEmmRecordStore } from "../../ports/ReaderDirectoryEmmRecordStore.js"
import type { ReaderEmmCatalogTag, ReaderEmmTagCatalogStore } from "../../ports/ReaderEmmTagCatalogStore.js"

export type ReaderEmmRecordCatalogStore = ReaderDirectoryEmmRecordStore & Partial<ReaderEmmTagCatalogStore>

export function composeReaderEmmStores(primary: ReaderEmmRecordCatalogStore, fallback?: ReaderEmmRecordCatalogStore): ReaderDirectoryEmmRecordStore & ReaderEmmTagCatalogStore {
  return {
    directoryEmmAvailable: primary.directoryEmmAvailable || Boolean(fallback?.directoryEmmAvailable),
    async readDirectoryEmmRecords(paths, signal) {
      const [primaryRecords, fallbackRecords] = await Promise.all([
        primary.readDirectoryEmmRecords(paths, signal),
        fallback?.readDirectoryEmmRecords(paths, signal) ?? Promise.resolve(new Map<string, ReaderDirectoryEmmRecord>()),
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
  }
}
