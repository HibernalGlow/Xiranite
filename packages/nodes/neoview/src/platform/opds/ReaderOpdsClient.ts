import { createHash, randomBytes } from "node:crypto"

import { XMLParser } from "fast-xml-parser"
import type {
  ReaderOpdsCatalog,
  ReaderOpdsCredentialProvider,
  ReaderOpdsCredentials,
  ReaderOpdsFetchOptions,
  ReaderOpdsLink,
  ReaderOpdsNavigationEntry,
  ReaderOpdsPublication,
  ReaderOpdsSearchParameters,
} from "../../ports/ReaderOpds.js"

export type {
  ReaderOpdsCatalog,
  ReaderOpdsCredentialProvider,
  ReaderOpdsCredentialRequest,
  ReaderOpdsCredentials,
  ReaderOpdsFetchOptions,
  ReaderOpdsLink,
  ReaderOpdsNavigationEntry,
  ReaderOpdsPublication,
  ReaderOpdsSearchParameters,
} from "../../ports/ReaderOpds.js"

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) => ["entry", "link", "navigation", "publication", "image", "acquisition"].includes(name),
})

export class ReaderOpdsClient {
  readonly #fetch: typeof globalThis.fetch
  readonly #maxBytes: number
  readonly #headers?: Readonly<Record<string, string>>
  readonly #credentials?: ReaderOpdsCredentialProvider

  constructor(options: ReaderOpdsFetchOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#maxBytes = boundedMaxBytes(options.maxBytes ?? DEFAULT_MAX_BYTES)
    this.#headers = options.headers
    this.#credentials = options.credentials
  }

  async read(url: string, signal?: AbortSignal): Promise<ReaderOpdsCatalog> {
    const normalizedUrl = normalizeUrl(url)
    signal?.throwIfAborted()
    const response = await this.#fetch(normalizedUrl, {
      headers: this.#headers,
      signal,
      redirect: "follow",
    })
    const authenticated = await this.#retryWithCredentials(response, normalizedUrl, signal)
    if (!authenticated.ok) throw new ReaderOpdsHttpError(
      authenticated.status,
      authenticated.statusText,
      authenticated.headers.get("www-authenticate")?.slice(0, 1_024),
    )
    const body = await readBoundedBody(authenticated, this.#maxBytes, signal)
    signal?.throwIfAborted()
    return parseReaderOpdsCatalog(body, authenticated.url ? normalizeUrl(authenticated.url) : normalizedUrl)
  }

  async #retryWithCredentials(response: Response, fallbackUrl: string, signal?: AbortSignal): Promise<Response> {
    if (response.ok || !this.#credentials || response.status !== 401) return response
    const challenge = response.headers.get("www-authenticate")?.slice(0, 1_024)
    if (!challenge) return response
    const finalUrl = response.url ? normalizeUrl(response.url) : fallbackUrl
    const credentials = await this.#credentials.getCredentials({ url: finalUrl, challenge, attempt: 1, signal })
    if (!credentials) return response
    signal?.throwIfAborted()
    const authorization = buildAuthorization(challenge, finalUrl, credentials)
    if (!authorization) return response
    const headers = { ...this.#headers, Authorization: authorization }
    return this.#fetch(finalUrl, { headers, signal, redirect: "follow" })
  }
}

export function parseReaderOpdsCatalog(body: string, url: string): ReaderOpdsCatalog {
  const normalizedUrl = normalizeUrl(url)
  const text = body.trim()
  if (!text) throw new ReaderOpdsParseError("OPDS response is empty")
  try {
    if (text.startsWith("{") || text.startsWith("[")) return parseJsonCatalog(JSON.parse(text), normalizedUrl)
    return parseAtomCatalog(parser.parse(text), normalizedUrl)
  } catch (error) {
    if (error instanceof ReaderOpdsParseError) throw error
    throw new ReaderOpdsParseError(error instanceof Error ? error.message : String(error))
  }
}

export function buildReaderOpdsSearchUrl(template: string, parameters: ReaderOpdsSearchParameters): string {
  const query = parameters.query.trim()
  if (!query || query.length > 2_048) throw new ReaderOpdsParseError("search query must contain 1 to 2048 characters")
  const values: Record<string, string | undefined> = {
    query,
    searchTerms: query,
    q: query,
    count: optionalSearchInteger(parameters.count, "count", 1),
    startPage: optionalSearchInteger(parameters.startPage, "startPage", 1),
    startIndex: optionalSearchInteger(parameters.startIndex, "startIndex", 0),
    language: optionalSearchLanguage(parameters.language),
    inputEncoding: "UTF-8",
    outputEncoding: "UTF-8",
  }
  let usedSearchTerm = false
  const expanded = template.replace(/\{([?&]?)([^{}]+)\}/g, (_expression, operator: string, variableList: string) => {
    const names = variableList.split(",").map((name) => name.trim())
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9]*$/.test(name))) throw new ReaderOpdsParseError("search template contains an unsupported variable")
    if (names.some((name) => name === "query" || name === "searchTerms" || name === "q")) usedSearchTerm = true
    if (!operator) {
      if (names.length !== 1) throw new ReaderOpdsParseError("search template expression is invalid")
      return encodeURIComponent(values[names[0]!] ?? "")
    }
    const pairs = names.flatMap((name) => values[name] === undefined ? [] : [`${encodeURIComponent(name)}=${encodeURIComponent(values[name]!)}`])
    return pairs.length ? `${operator}${pairs.join("&")}` : ""
  })
  if (!usedSearchTerm) throw new ReaderOpdsParseError("search template does not accept search terms")
  if (/[{}]/.test(expanded)) throw new ReaderOpdsParseError("search template contains an invalid expression")
  return normalizeUrl(expanded)
}

export class ReaderOpdsHttpError extends Error {
  constructor(readonly status: number, statusText: string, readonly authenticate?: string) {
    super(`OPDS request failed with HTTP ${status}${statusText ? `: ${statusText}` : ""}`)
    this.name = "ReaderOpdsHttpError"
  }
}

export class ReaderOpdsParseError extends Error {
  constructor(message: string) {
    super(`Invalid OPDS catalog: ${message}`)
    this.name = "ReaderOpdsParseError"
  }
}

async function readBoundedBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ReaderOpdsParseError("response exceeds size limit")
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > maxBytes) throw new ReaderOpdsParseError("response exceeds size limit")
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

function parseJsonCatalog(value: unknown, url: string): ReaderOpdsCatalog {
  const root = object(value)
  const metadata = object(root.metadata)
  const links = parseLinks(root.links, url)
  const navigation = array(root.navigation).map((item) => {
    const entry = object(item)
    return {
      title: requiredText(entry.title ?? entry.name, "navigation title"),
      href: resolveHref(entry.href, url),
      ...(optionalText(entry.type) ? { type: optionalText(entry.type) } : {}),
      ...(optionalText(entry.rel) ? { rel: optionalText(entry.rel) } : {}),
    }
  })
  const publications = array(root.publications).map((item) => {
    const publication = object(item)
    const publicationLinks = parseLinks(publication.links, url)
    const acquisition = [...publicationLinks, ...parseLinks(publication.acquisition, url)]
      .filter((link) => link.rel?.includes("acquisition") || link.rel === "preview")
    const images = array(publication.images).map((image) => {
      const record = object(image)
      return resolveHref(record.href, url)
    })
    return {
      ...(optionalText(publication.metadata && object(publication.metadata).identifier) ? { id: optionalText(object(publication.metadata).identifier) } : {}),
      title: requiredText(object(publication.metadata).title ?? publication.title, "publication title"),
      ...(optionalText(object(publication.metadata).description ?? publication.summary) ? { summary: optionalText(object(publication.metadata).description ?? publication.summary) } : {}),
      ...(optionalText(object(publication.metadata).language ?? publication.language) ? { language: optionalText(object(publication.metadata).language ?? publication.language) } : {}),
      images,
      acquisition,
      links: publicationLinks,
    }
  })
  return {
    url,
    ...(optionalText(metadata.title ?? root.title) ? { title: optionalText(metadata.title ?? root.title) } : {}),
    ...(optionalText(metadata.subtitle ?? root.subtitle) ? { subtitle: optionalText(metadata.subtitle ?? root.subtitle) } : {}),
    ...(optionalText(metadata.identifier ?? root.id) ? { id: optionalText(metadata.identifier ?? root.id) } : {}),
    navigation,
    publications,
    links,
    ...paginationFromLinks(links),
  }
}

function parseAtomCatalog(root: Record<string, unknown>, url: string): ReaderOpdsCatalog {
  const feed = object(root.feed ?? root)
  const links = parseLinks(feed.link, url)
  const navigation = array(feed.entry).filter((item) => !isPublicationEntry(item)).map((item) => {
    const entry = object(item)
    return {
      title: requiredText(entry.title, "navigation title"),
      href: resolveHref(firstLinkHref(entry.link), url),
      ...(optionalText(entry.contentType) ? { type: optionalText(entry.contentType) } : {}),
      ...(optionalText(entry.rel) ? { rel: optionalText(entry.rel) } : {}),
    }
  })
  const publications = array(feed.entry).filter(isPublicationEntry).map((item) => {
    const entry = object(item)
    const entryLinks = parseLinks(entry.link, url)
    const acquisition = entryLinks.filter((link) => link.rel?.includes("acquisition") || link.rel === "preview")
    const images = entryLinks
      .filter((link) => link.rel === "thumbnail" || link.rel === "image" || link.type?.startsWith("image/"))
      .map((link) => link.href)
    return {
      ...(optionalText(entry.id) ? { id: optionalText(entry.id) } : {}),
      title: requiredText(entry.title, "publication title"),
      ...(optionalText(entry.summary ?? entry.content) ? { summary: optionalText(entry.summary ?? entry.content) } : {}),
      ...(optionalText(entry.language) ? { language: optionalText(entry.language) } : {}),
      images,
      acquisition,
      links: entryLinks,
    }
  })
  return {
    url,
    ...(optionalText(feed.title) ? { title: optionalText(feed.title) } : {}),
    ...(optionalText(feed.subtitle) ? { subtitle: optionalText(feed.subtitle) } : {}),
    ...(optionalText(feed.id) ? { id: optionalText(feed.id) } : {}),
    navigation,
    publications,
    links,
    ...paginationFromLinks(links),
  }
}

function parseLinks(value: unknown, baseUrl: string): ReaderOpdsLink[] {
  return array(value).flatMap((item) => {
    const record = object(item)
    if (typeof record === "string") return []
    const href = field(record, "href")
    if (typeof href !== "string" || !href.trim()) return []
    const price = object(field(record, "price"))
    const numericPrice = typeof price.value === "number" && Number.isFinite(price.value) ? { value: price.value, ...(optionalText(price.currency) ? { currency: optionalText(price.currency) } : {}) } : undefined
    return [{
      href: resolveHref(href, baseUrl),
      ...(optionalText(field(record, "rel")) ? { rel: optionalText(field(record, "rel")) } : {}),
      ...(optionalText(field(record, "type")) ? { type: optionalText(field(record, "type")) } : {}),
      ...(optionalText(field(record, "title")) ? { title: optionalText(field(record, "title")) } : {}),
      ...(numericPrice ? { price: numericPrice } : {}),
    }]
  })
}

function paginationFromLinks(links: readonly ReaderOpdsLink[]): Pick<ReaderOpdsCatalog, "next" | "previous" | "first" | "last" | "search"> {
  const result: Pick<ReaderOpdsCatalog, "next" | "previous" | "first" | "last" | "search"> = {}
  for (const link of links) {
    if (link.rel === "next") result.next = link.href
    else if (link.rel === "prev" || link.rel === "previous") result.previous = link.href
    else if (link.rel === "first") result.first = link.href
    else if (link.rel === "last") result.last = link.href
    else if (link.rel === "search" || link.type === "application/opensearchdescription+xml") result.search = link.href
  }
  return result
}

function isPublicationEntry(value: unknown): boolean {
  const entry = object(value)
  return array(entry.link).some((link) => {
    const rel = optionalText(field(object(link), "rel")) ?? ""
    return rel.includes("acquisition") || rel === "preview"
  })
}

function firstLinkHref(value: unknown): string {
  const link = array(value).map(object).find((item) => typeof field(item, "href") === "string")
  return requiredText(field(link ?? {}, "href"), "navigation href")
}

function resolveHref(value: unknown, baseUrl: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ReaderOpdsParseError("link href is missing")
  const templateStart = value.indexOf("{")
  if (templateStart >= 0) {
    const templateBase = value.slice(0, templateStart)
    const template = value.slice(templateStart)
    if (!templateBase || !template.includes("}")) throw new ReaderOpdsParseError("link template is invalid")
    return `${normalizeUrl(new URL(templateBase, baseUrl).href)}${template}`
  }
  return normalizeUrl(new URL(value, baseUrl).href)
}

function normalizeUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ReaderOpdsParseError("URL is invalid")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ReaderOpdsParseError("only HTTP(S) URLs are supported")
  if (url.username || url.password) throw new ReaderOpdsParseError("URLs must not contain credentials")
  if (url.href.length > 8_192) throw new ReaderOpdsParseError("URL is too long")
  return url.href
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function array(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value && typeof value === "object" && !Array.isArray(value)) return optionalText((value as Record<string, unknown>)["#text"])
  return undefined
}

function requiredText(value: unknown, name: string): string {
  const text = optionalText(value)
  if (!text) throw new ReaderOpdsParseError(`${name} is missing`)
  return text
}

function field(record: Record<string, any>, name: string): unknown {
  return record[name] ?? record[`@_${name}`]
}

function boundedMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 64 * 1024 * 1024) throw new RangeError("OPDS maxBytes must be an integer from 1024 to 67108864")
  return value
}

function optionalSearchInteger(value: number | undefined, name: string, minimum: number): string | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) {
    throw new ReaderOpdsParseError(`${name} must be an integer from ${minimum} to 1000000`)
  }
  return String(value)
}

function optionalSearchLanguage(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const language = value.trim()
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) throw new ReaderOpdsParseError("search language is invalid")
  return language
}

function buildAuthorization(challenge: string, url: string, credentials: ReaderOpdsCredentials): string | undefined {
  const parsed = parseChallenge(challenge)
  if (!parsed) return undefined
  const passwordBytes = credentials.password.slice()
  const password = new TextDecoder().decode(passwordBytes)
  try {
    if (parsed.scheme === "basic") {
      return `Basic ${Buffer.from(`${credentials.username}:${password}`, "utf8").toString("base64")}`
    }
    const algorithm = normalizeDigestAlgorithm(parsed.parameters.algorithm)
    if (!algorithm || !parsed.parameters.realm || !parsed.parameters.nonce) return undefined
    const qop = selectDigestQop(parsed.parameters.qop)
    if (parsed.parameters.qop && !qop) return undefined
    const uri = `${new URL(url).pathname}${new URL(url).search}` || "/"
    const cnonce = randomBytes(16).toString("hex")
    const nc = "00000001"
    const ha1 = digest(algorithm.base, `${credentials.username}:${parsed.parameters.realm}:${password}`)
    const ha2 = digest(algorithm.base, `GET:${uri}`)
    const response = qop
      ? digest(algorithm.base, `${ha1}:${parsed.parameters.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : digest(algorithm.base, `${ha1}:${parsed.parameters.nonce}:${ha2}`)
    const values = [
      `username="${quote(credentials.username)}"`,
      `realm="${quote(parsed.parameters.realm)}"`,
      `nonce="${quote(parsed.parameters.nonce)}"`,
      `uri="${quote(uri)}"`,
      `algorithm=${algorithm.header}`,
      `response="${response}"`,
    ]
    if (parsed.parameters.opaque) values.push(`opaque="${quote(parsed.parameters.opaque)}"`)
    if (qop) values.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
    return `Digest ${values.join(", ")}`
  } finally {
    passwordBytes.fill(0)
  }
}

interface ParsedChallenge {
  scheme: "basic" | "digest"
  parameters: Record<string, string>
}

function parseChallenge(value: string): ParsedChallenge | undefined {
  const match = /(?:^|,\s*)(basic|digest)\s+(.+)/i.exec(value)
  if (!match) return undefined
  const scheme = match[1]!.toLowerCase() as ParsedChallenge["scheme"]
  const parameters: Record<string, string> = {}
  const source = match[2]!
  const pattern = /([a-z][a-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/gi
  for (const item of source.matchAll(pattern)) {
    parameters[item[1]!.toLowerCase()] = (item[2] ?? item[3] ?? "").replace(/\\([\\"])/g, "$1")
  }
  return { scheme, parameters }
}

function normalizeDigestAlgorithm(value: string | undefined): { base: string; header: string } | undefined {
  const normalized = (value ?? "MD5").toLowerCase()
  if (normalized.endsWith("-sess")) return undefined
  const base = normalized
  if (!new Set(["md5", "sha-256", "sha-512-256"]).has(base)) return undefined
  return { base, header: value ?? "MD5" }
}

function selectDigestQop(value: string | undefined): "auth" | undefined {
  if (!value) return undefined
  return value.split(",").map((item) => item.trim().toLowerCase()).includes("auth") ? "auth" : undefined
}

function digest(algorithm: string, value: string): string {
  return createHash(algorithm).update(value, "utf8").digest("hex")
}

function quote(value: string): string {
  return value.replace(/[\\"]/g, (character) => `\\${character}`)
}
