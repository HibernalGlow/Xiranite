import {
  DEFAULT_READER_DIRECTORY_SORT,
  type ReaderDirectorySortRule,
} from "./ReaderDirectorySort.js"

export type ReaderDirectorySortSource = "temporary" | "memory" | "tab-default" | "global-default"
export type ReaderDirectorySortDefaultScope = "global" | "tab"

export interface ReaderDirectoryTemporarySortRule {
  pathKey: string
  sort: ReaderDirectorySortRule
}

export interface ReaderDirectorySortPreferenceSnapshot {
  sort: ReaderDirectorySortRule
  source: ReaderDirectorySortSource
  temporary: boolean
  globalDefault: ReaderDirectorySortRule
  tabDefault: ReaderDirectorySortRule
}

export interface ReaderDirectorySortPreferenceStore {
  getGlobalDefault(): Promise<ReaderDirectorySortRule | undefined>
  setGlobalDefault(sort: ReaderDirectorySortRule): Promise<void>
  getTabDefault(scopeId: string): Promise<ReaderDirectorySortRule | undefined>
  setTabDefault(scopeId: string, sort: ReaderDirectorySortRule): Promise<void>
  getFolderRule(pathKey: string): Promise<ReaderDirectorySortRule | undefined>
  setFolderRule(pathKey: string, path: string, sort: ReaderDirectorySortRule, updatedAt: number): Promise<void>
  clearFolderRules(pathKey?: string): Promise<number>
}

export class CoreReaderDirectorySortPreferences {
  readonly #store: ReaderDirectorySortPreferenceStore

  constructor(store: ReaderDirectorySortPreferenceStore = new MemoryReaderDirectorySortPreferenceStore()) {
    this.#store = store
  }

  async resolve(
    scopeId: string,
    path: string,
    temporary?: ReaderDirectoryTemporarySortRule,
  ): Promise<ReaderDirectorySortPreferenceSnapshot> {
    const pathKey = normalizeDirectorySortPath(path)
    const [globalDefault, tabDefault, folderRule] = await Promise.all([
      this.#store.getGlobalDefault(),
      this.#store.getTabDefault(scopeId),
      this.#store.getFolderRule(pathKey),
    ])
    const globalSort = globalDefault ?? DEFAULT_READER_DIRECTORY_SORT
    const tabSort = tabDefault ?? globalSort
    if (temporary?.pathKey === pathKey) return snapshot(temporary.sort, "temporary", globalSort, tabSort)
    if (folderRule) return snapshot(folderRule, "memory", globalSort, tabSort)
    if (tabDefault) return snapshot(tabSort, "tab-default", globalSort, tabSort)
    return snapshot(globalSort, "global-default", globalSort, tabSort)
  }

  async rememberCurrent(
    scopeId: string,
    path: string,
    sort: ReaderDirectorySortRule,
    temporary?: ReaderDirectoryTemporarySortRule,
  ): Promise<{ preference: ReaderDirectorySortPreferenceSnapshot; temporary?: ReaderDirectoryTemporarySortRule }> {
    const pathKey = normalizeDirectorySortPath(path)
    if (temporary?.pathKey === pathKey) {
      const nextTemporary = { pathKey, sort }
      return { preference: await this.resolve(scopeId, path, nextTemporary), temporary: nextTemporary }
    }
    await this.#store.setFolderRule(pathKey, path, sort, Date.now())
    return { preference: await this.resolve(scopeId, path), temporary }
  }

  async setTemporary(
    scopeId: string,
    path: string,
    enabled: boolean,
    currentSort: ReaderDirectorySortRule,
  ): Promise<{ preference: ReaderDirectorySortPreferenceSnapshot; temporary?: ReaderDirectoryTemporarySortRule }> {
    const temporary = enabled ? { pathKey: normalizeDirectorySortPath(path), sort: currentSort } : undefined
    return { preference: await this.resolve(scopeId, path, temporary), temporary }
  }

  async setDefault(scopeId: string, scope: ReaderDirectorySortDefaultScope, sort: ReaderDirectorySortRule): Promise<void> {
    if (scope === "global") await this.#store.setGlobalDefault(sort)
    else await this.#store.setTabDefault(scopeId, sort)
  }

  async clearMemory(path?: string): Promise<number> {
    return this.#store.clearFolderRules(path ? normalizeDirectorySortPath(path) : undefined)
  }
}

export class MemoryReaderDirectorySortPreferenceStore implements ReaderDirectorySortPreferenceStore {
  #globalDefault?: ReaderDirectorySortRule
  readonly #tabDefaults = new Map<string, ReaderDirectorySortRule>()
  readonly #folderRules = new Map<string, ReaderDirectorySortRule>()

  async getGlobalDefault(): Promise<ReaderDirectorySortRule | undefined> {
    return this.#globalDefault
  }

  async setGlobalDefault(sort: ReaderDirectorySortRule): Promise<void> {
    this.#globalDefault = sort
  }

  async getTabDefault(scopeId: string): Promise<ReaderDirectorySortRule | undefined> {
    return this.#tabDefaults.get(scopeId)
  }

  async setTabDefault(scopeId: string, sort: ReaderDirectorySortRule): Promise<void> {
    this.#tabDefaults.set(scopeId, sort)
  }

  async getFolderRule(pathKey: string): Promise<ReaderDirectorySortRule | undefined> {
    return this.#folderRules.get(pathKey)
  }

  async setFolderRule(pathKey: string, _path: string, sort: ReaderDirectorySortRule): Promise<void> {
    this.#folderRules.set(pathKey, sort)
  }

  async clearFolderRules(pathKey?: string): Promise<number> {
    if (pathKey) return this.#folderRules.delete(pathKey) ? 1 : 0
    const count = this.#folderRules.size
    this.#folderRules.clear()
    return count
  }
}

export function normalizeDirectorySortPath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}

function snapshot(
  sort: ReaderDirectorySortRule,
  source: ReaderDirectorySortSource,
  globalDefault: ReaderDirectorySortRule,
  tabDefault: ReaderDirectorySortRule,
): ReaderDirectorySortPreferenceSnapshot {
  return { sort, source, temporary: source === "temporary", globalDefault, tabDefault }
}
