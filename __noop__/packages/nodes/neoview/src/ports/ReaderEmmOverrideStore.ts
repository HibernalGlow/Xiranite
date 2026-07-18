export interface ReaderEmmTag {
  namespace: string
  tag: string
}

export interface ReaderEmmOverrides {
  rating?: number
  manualTags?: readonly ReaderEmmTag[]
  translatedTitle?: string
}

export interface ReaderEmmOverrideRecord {
  path: string
  overrides: ReaderEmmOverrides
  revision: number
  updatedAt: number
}

export interface ReaderEmmOverrideStore {
  getEmmOverride(path: string): Promise<ReaderEmmOverrideRecord | undefined>
  saveEmmOverride(
    path: string,
    overrides: ReaderEmmOverrides,
    expectedRevision: number,
    updatedAt: number,
  ): Promise<ReaderEmmOverrideRecord | undefined>
}
