import { describe, expect, it, vi } from "vitest"

import { buildReaderOpdsSearchUrl, ReaderOpdsClient, ReaderOpdsHttpError, parseReaderOpdsCatalog } from "./ReaderOpdsClient.js"

describe("ReaderOpdsClient", () => {
  it("[neoview.opds.v2] normalizes navigation, publications, acquisition and pagination", () => {
    const catalog = parseReaderOpdsCatalog(JSON.stringify({
      metadata: { title: "Library", identifier: "urn:library" },
      links: [
        { rel: "next", href: "?page=2", type: "application/opds+json" },
        { rel: "search", href: "/search{?query}", type: "application/opensearchdescription+xml" },
      ],
      navigation: [{ title: "Manga", href: "manga", type: "application/opds+json" }],
      publications: [{
        metadata: { identifier: "book-1", title: "Book One", description: "Summary", language: "en" },
        images: [{ href: "covers/1.jpg" }],
        links: [
          { rel: "http://opds-spec.org/acquisition/open-access", href: "books/1.cbz", type: "application/vnd.comicbook+zip" },
          { rel: "alternate", href: "books/1", type: "text/html" },
        ],
      }],
    }), "https://catalog.example/root/feed.json")

    expect(catalog).toMatchObject({
      url: "https://catalog.example/root/feed.json",
      title: "Library",
      id: "urn:library",
      next: "https://catalog.example/root/feed.json?page=2",
      search: "https://catalog.example/search{?query}",
      navigation: [{ title: "Manga", href: "https://catalog.example/root/manga", type: "application/opds+json" }],
    })
    expect(catalog.publications[0]).toEqual({
      id: "book-1",
      title: "Book One",
      summary: "Summary",
      language: "en",
      images: ["https://catalog.example/root/covers/1.jpg"],
      acquisition: [{
        rel: "http://opds-spec.org/acquisition/open-access",
        href: "https://catalog.example/root/books/1.cbz",
        type: "application/vnd.comicbook+zip",
      }],
      links: expect.arrayContaining([expect.objectContaining({ href: "https://catalog.example/root/books/1.cbz" })]),
    })
  })

  it("[neoview.opds.v1] parses Atom attributes, text nodes, navigation and publications", () => {
    const catalog = parseReaderOpdsCatalog(`<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <id>urn:feed</id><title>Atom Library</title><subtitle>Books</subtitle>
        <link rel="next" href="page/2.xml" type="application/atom+xml;profile=opds-catalog" />
        <link rel="search" href="search.xml" type="application/opensearchdescription+xml" />
        <entry><id>category-1</id><title>Category</title><link href="category.xml" type="application/atom+xml;profile=opds-catalog" /></entry>
        <entry>
          <id>book-1</id><title>Atom Book</title><summary type="text">Atom Summary</summary>
          <link rel="http://opds-spec.org/image/thumbnail" href="cover.jpg" type="image/jpeg" />
          <link rel="http://opds-spec.org/acquisition/open-access" href="book.cbz" type="application/vnd.comicbook+zip" />
        </entry>
      </feed>`, "https://catalog.example/root/index.xml")

    expect(catalog).toMatchObject({
      title: "Atom Library",
      subtitle: "Books",
      id: "urn:feed",
      next: "https://catalog.example/root/page/2.xml",
      search: "https://catalog.example/root/search.xml",
      navigation: [{ title: "Category", href: "https://catalog.example/root/category.xml" }],
    })
    expect(catalog.publications[0]).toMatchObject({
      id: "book-1",
      title: "Atom Book",
      summary: "Atom Summary",
      images: ["https://catalog.example/root/cover.jpg"],
      acquisition: [expect.objectContaining({ href: "https://catalog.example/root/book.cbz" })],
    })
  })

  it("[neoview.opds.fetch] follows the final response URL and forwards cancellation", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("follow")
      return Object.defineProperty(Response.json({ metadata: { title: "Redirected" } }), "url", {
        value: "https://cdn.example/catalog.json",
      })
    })
    const client = new ReaderOpdsClient({ fetch: fetch as typeof globalThis.fetch })
    await expect(client.read("https://catalog.example/start")).resolves.toMatchObject({
      url: "https://cdn.example/catalog.json",
      title: "Redirected",
    })

    const abort = new AbortController()
    abort.abort(new DOMException("catalog closed", "AbortError"))
    await expect(client.read("https://catalog.example/start", abort.signal)).rejects.toThrow("catalog closed")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("[neoview.opds.bounds] rejects oversized, failed and unsafe responses", async () => {
    const oversized = new ReaderOpdsClient({
      maxBytes: 1_024,
      fetch: vi.fn(async () => new Response("x".repeat(1_025))) as typeof globalThis.fetch,
    })
    await expect(oversized.read("https://catalog.example/feed")).rejects.toThrow("size limit")

    const failing = new ReaderOpdsClient({
      fetch: vi.fn(async () => new Response("no", { status: 401, statusText: "Unauthorized", headers: { "www-authenticate": "Basic realm=books" } })) as typeof globalThis.fetch,
    })
    await expect(failing.read("https://catalog.example/feed")).rejects.toMatchObject({
      name: "ReaderOpdsHttpError", status: 401, authenticate: "Basic realm=books",
    })
    await expect(failing.read("https://user:secret@catalog.example/feed")).rejects.toThrow("credentials")
    expect(() => parseReaderOpdsCatalog("", "https://catalog.example/feed")).toThrow("empty")
    expect(() => parseReaderOpdsCatalog('{"navigation":[{"title":"Bad","href":"javascript:alert(1)"}]}', "https://catalog.example/feed")).toThrow("HTTP(S)")
  })

  it("[neoview.opds.auth-basic] retries one challenge with an injected Basic credential", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("login", { status: 401, headers: { "www-authenticate": 'Basic realm="books"' } }))
      .mockResolvedValueOnce(Response.json({ metadata: { title: "Private" } }))
    const password = new TextEncoder().encode("secret")
    const client = new ReaderOpdsClient({
      fetch: fetch as typeof globalThis.fetch,
      credentials: { getCredentials: vi.fn(async () => ({ username: "reader", password })) },
    })
    await expect(client.read("https://catalog.example/private/feed")).resolves.toMatchObject({ title: "Private" })
    const authorization = new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")
    expect(authorization).toBe(`Basic ${Buffer.from("reader:secret").toString("base64")}`)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("[neoview.opds.auth-digest] creates a per-request Digest auth response without sending credentials in the URL", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("login", { status: 401, headers: { "www-authenticate": 'Digest realm="books", nonce="abc", algorithm=SHA-256, qop="auth"' } }))
      .mockResolvedValueOnce(Response.json({ metadata: { title: "Private" } }))
    const client = new ReaderOpdsClient({
      fetch: fetch as typeof globalThis.fetch,
      credentials: { getCredentials: vi.fn(async () => ({ username: "reader", password: new TextEncoder().encode("secret") })) },
    })
    await expect(client.read("https://catalog.example/private/feed?page=2")).resolves.toMatchObject({ title: "Private" })
    const authorization = new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization") ?? ""
    expect(authorization).toMatch(/^Digest username="reader", realm="books", nonce="abc", uri="\/private\/feed\?page=2", algorithm=SHA-256, response="[0-9a-f]{64}", qop=auth, nc=00000001, cnonce="[0-9a-f]+"$/)
    expect(String(fetch.mock.calls[1]?.[0])).not.toContain("secret")
  })

  it("[neoview.opds.auth-bounds] does not retry unsupported qop or more than once", async () => {
    const fetch = vi.fn(async () => new Response("login", { status: 401, headers: { "www-authenticate": 'Digest realm="books", nonce="abc", qop="auth-int"' } }))
    const provider = { getCredentials: vi.fn(async () => ({ username: "reader", password: new TextEncoder().encode("secret") })) }
    const client = new ReaderOpdsClient({ fetch: fetch as typeof globalThis.fetch, credentials: provider })
    await expect(client.read("https://catalog.example/private/feed")).rejects.toMatchObject({ status: 401 })
    expect(provider.getCredentials).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("[neoview.opds.search-template] expands OPDS and OpenSearch query variables without leaving raw placeholders", () => {
    expect(buildReaderOpdsSearchUrl("https://catalog.example/search{?query,count,startPage,language}", {
      query: "space opera", count: 20, startPage: 2, language: "zh-Hans",
    })).toBe("https://catalog.example/search?query=space%20opera&count=20&startPage=2&language=zh-Hans")
    expect(buildReaderOpdsSearchUrl("https://catalog.example/search?q={searchTerms}&start={startIndex}", {
      query: "manga", startIndex: 0,
    })).toBe("https://catalog.example/search?q=manga&start=0")
    expect(() => buildReaderOpdsSearchUrl("https://catalog.example/search{?count}", { query: "missing" })).toThrow("search terms")
    expect(() => buildReaderOpdsSearchUrl("https://catalog.example/search{?query*}", { query: "bad" })).toThrow("unsupported")
  })
})
