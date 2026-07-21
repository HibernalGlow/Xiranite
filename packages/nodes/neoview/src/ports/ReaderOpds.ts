export interface ReaderOpdsLink {
  href: string
  rel?: string
  type?: string
  title?: string
  price?: { value: number; currency?: string }
}

export interface ReaderOpdsNavigationEntry {
  title: string
  href: string
  type?: string
  rel?: string
}

export interface ReaderOpdsPublication {
  id?: string
  title: string
  summary?: string
  language?: string
  images: readonly string[]
  acquisition: readonly ReaderOpdsLink[]
  links: readonly ReaderOpdsLink[]
}

export interface ReaderOpdsCatalog {
  url: string
  title?: string
  subtitle?: string
  id?: string
  navigation: readonly ReaderOpdsNavigationEntry[]
  publications: readonly ReaderOpdsPublication[]
  links: readonly ReaderOpdsLink[]
  next?: string
  previous?: string
  first?: string
  last?: string
  search?: string
}

export interface ReaderOpdsFetchOptions {
  fetch?: typeof globalThis.fetch
  maxBytes?: number
  headers?: Readonly<Record<string, string>>
  credentials?: ReaderOpdsCredentialProvider
}

export interface ReaderOpdsCredentialRequest {
  url: string
  challenge: string
  attempt: number
  signal?: AbortSignal
}

export interface ReaderOpdsCredentials {
  username: string
  /** The provider owns this buffer. The client copies it and never mutates it. */
  password: Uint8Array
}

export interface ReaderOpdsCredentialProvider {
  getCredentials(request: ReaderOpdsCredentialRequest): Promise<ReaderOpdsCredentials | undefined>
}

export interface ReaderOpdsSearchParameters {
  query: string
  count?: number
  startPage?: number
  startIndex?: number
  language?: string
}

export interface ReaderOpdsCatalogReader {
  read(url: string, signal?: AbortSignal): Promise<ReaderOpdsCatalog>
}
