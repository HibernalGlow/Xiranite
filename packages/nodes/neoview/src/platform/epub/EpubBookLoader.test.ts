import { afterEach, describe, expect, it } from "vitest"

import { createZipFixture, type ZipFixture } from "../../../test/fixture-builders/create-zip-fixture.js"
import { CoreReaderService } from "../../application/reader/ReaderService.js"
import { ReaderAssetRoute } from "../asset-route/ReaderAssetRoute.js"
import { createPlatformReaderBookLoader } from "../books/PlatformReaderBookLoader.js"

const fixtures: ZipFixture[] = []
const encoder = new TextEncoder()

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()))
})

describe("EpubBookLoader", () => {
  it("[neoview.epub.manifest] [neoview.epub.stream] parses OPF with fast-xml-parser and streams path-sorted image resources", async () => {
    const fixture = await epubFixture()
    fixtures.push(fixture)
    const book = await createPlatformReaderBookLoader()({ kind: "document", path: fixture.path, format: "epub" })
    try {
      expect(book.source).toEqual({ kind: "document", path: fixture.path, format: "epub" })
      expect(book.pages.map((page) => page.entryPath)).toEqual([
        "Images/10.png",
        "Images/2.jpg",
        "Images/cover image.jpg",
        "Images/extensionless",
      ])
      expect(book.pages.map((page) => page.mimeType)).toEqual(["image/png", "image/jpeg", "image/jpeg", "image/png"])
      expect(book.pages.map((page) => page.thumbnailSource)).toEqual(book.pages.map((page) => ({
        key: `${fixture.path}::${page.entryPath}#${page.entryPath === "Images/10.png" ? 3 : page.entryPath === "Images/2.jpg" ? 4 : page.entryPath === "Images/cover image.jpg" ? 5 : 6}`,
        category: "file",
      })))
      const source = await book.pages[2]!.content.load()
      expect(new Uint8Array(await new Response(await source.open()).arrayBuffer())).toEqual(Uint8Array.of(3, 3, 3))
      await source.close()
    } finally {
      await book.close()
    }
    const closedSource = await book.pages[0]!.content.load()
    await expect(closedSource.open()).rejects.toThrow("closed")
  })

  it("[neoview.epub.validation] rejects missing, oversized and escaping package metadata", async () => {
    const missing = await createZipFixture({ name: "missing.epub", entries: [{ path: "mimetype", bytes: encoder.encode("application/epub+zip") }] })
    const oversized = await createZipFixture({ name: "oversized.epub", entries: [
      { path: "META-INF/container.xml", bytes: new Uint8Array(1024 * 1024 + 1), level: 0 },
    ] })
    const escaping = await createZipFixture({ name: "escaping.epub", entries: [
      { path: "META-INF/container.xml", bytes: encoder.encode(containerXml("../../outside.opf")), level: 0 },
    ] })
    fixtures.push(missing, oversized, escaping)
    const loader = createPlatformReaderBookLoader()
    await expect(loader({ kind: "document", path: missing.path, format: "epub" })).rejects.toThrow("container.xml")
    await expect(loader({ kind: "document", path: oversized.path, format: "epub" })).rejects.toThrow("exceeds 1048576 bytes")
    await expect(loader({ kind: "document", path: escaping.path, format: "epub" })).rejects.toThrow("Unsafe archive entry path")
  })

  it("[neoview.epub.cancellation] rejects a cancelled open before parsing the archive", async () => {
    const fixture = await epubFixture()
    fixtures.push(fixture)
    const abort = new AbortController()
    abort.abort(new Error("EPUB navigation cancelled"))
    await expect(createPlatformReaderBookLoader()(
      { kind: "document", path: fixture.path, format: "epub" },
      { signal: abort.signal },
    )).rejects.toThrow("EPUB navigation cancelled")
  })

  it("[neoview.epub.reader-e2e] auto-detects EPUB and streams its pages through the shared asset route", async () => {
    const fixture = await epubFixture()
    fixtures.push(fixture)
    const service = new CoreReaderService(createPlatformReaderBookLoader())
    const session = await service.openViewSource({ kind: "path", path: fixture.path })
    const route = new ReaderAssetRoute(service, { baseUrl: "http://127.0.0.1:41000", token: "epub-token" })
    try {
      expect(session.book.source).toEqual({ kind: "document", path: fixture.path, format: "epub" })
      const page = session.book.pages[2]!
      const response = (await route.handle(new Request(route.pageUrl(session.id, page.id))))!
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/jpeg")
      expect(response.headers.has("accept-ranges")).toBe(false)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(3, 3, 3))
    } finally {
      route.close()
      await service[Symbol.asyncDispose]()
    }
  })

  it("[neoview.epub.validation] rejects malformed OPF and deduplicates repeated manifest resources", async () => {
    const malformed = await createZipFixture({ name: "malformed.epub", entries: [
      { path: "META-INF/container.xml", bytes: encoder.encode(containerXml("OPS/package.opf")), level: 0 },
      { path: "OPS/package.opf", bytes: encoder.encode("<package><manifest><item"), level: 0 },
    ] })
    const duplicate = await createZipFixture({ name: "duplicate.epub", entries: [
      { path: "META-INF/container.xml", bytes: encoder.encode(containerXml("OPS/package.opf")), level: 0 },
      { path: "OPS/package.opf", bytes: encoder.encode(`
        <package><manifest>
          <item href="../Images/page.jpg" media-type="image/jpeg"/>
          <item href="../Images/page.jpg" media-type="image/jpeg"/>
        </manifest></package>`), level: 0 },
      { path: "Images/page.jpg", bytes: Uint8Array.of(7), level: 0 },
    ] })
    fixtures.push(malformed, duplicate)
    const loader = createPlatformReaderBookLoader()
    await expect(loader({ kind: "document", path: malformed.path, format: "epub" })).rejects.toThrow("EPUB package XML is invalid")
    const book = await loader({ kind: "document", path: duplicate.path, format: "epub" })
    try {
      expect(book.pages.map((page) => page.entryPath)).toEqual(["Images/page.jpg"])
    } finally {
      await book.close()
    }
  })
})

async function epubFixture(): Promise<ZipFixture> {
  return createZipFixture({
    name: "book.epub",
    entries: [
      { path: "mimetype", bytes: encoder.encode("application/epub+zip"), level: 0 },
      { path: "META-INF/container.xml", bytes: encoder.encode(containerXml("OPS/package.opf")), level: 0 },
      { path: "OPS/package.opf", bytes: encoder.encode(packageXml()), level: 6 },
      { path: "Images/10.png", bytes: Uint8Array.of(1), level: 0 },
      { path: "Images/2.jpg", bytes: Uint8Array.of(2, 2), level: 6 },
      { path: "Images/cover image.jpg", bytes: Uint8Array.of(3, 3, 3), level: 0 },
      { path: "Images/extensionless", bytes: Uint8Array.of(4), level: 0 },
      { path: "OPS/style.css", bytes: encoder.encode("body{}"), level: 0 },
    ],
  })
}

function containerXml(packagePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`
}

function packageXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>
        <item id="two" href="../Images/2.jpg" media-type="image/jpeg"/>
        <item id="ten" href="../Images/10.png" media-type="image/png"/>
        <item id="cover" href="../Images/cover%20image.jpg" media-type="image/jpeg"/>
        <item id="extensionless" href="../Images/extensionless" media-type="image/png"/>
        <item id="style" href="style.css" media-type="text/css"/>
        <item id="missing" href="../Images/missing.png" media-type="image/png"/>
      </manifest>
    </package>`
}
