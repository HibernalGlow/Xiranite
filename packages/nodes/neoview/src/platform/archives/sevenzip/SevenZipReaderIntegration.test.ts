import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CoreReaderService } from "../../../application/reader/ReaderService.js"
import { createZipFixture, type ZipFixture } from "../../../../test/fixture-builders/create-zip-fixture.js"
import { ReaderAssetRoute } from "../../asset-route/ReaderAssetRoute.js"
import { createPlatformReaderBookLoader } from "../../books/PlatformReaderBookLoader.js"
import { detectViewSource } from "../../filesystem/detectViewSource.js"
import { StreamingImageMetadataProbe } from "../../images/StreamingImageMetadataProbe.js"
import { resolveSevenZipExecutable } from "./SevenZipExecutable.js"

const execFileAsync = promisify(execFile)
const executable = await resolveSevenZipExecutable().catch(() => undefined)
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
)
let directory = ""
let archivePath = ""
let solidArchivePath = ""
let solidNestedArchivePath = ""
let innerFixture: ZipFixture | undefined

beforeAll(async () => {
  if (!executable) return
  directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cb7-"))
  await mkdir(join(directory, "pages"))
  await writeFile(join(directory, "pages", "10.png"), ONE_PIXEL_PNG)
  await writeFile(join(directory, "pages", "2.png"), ONE_PIXEL_PNG)
  await writeFile(join(directory, "pages", "readme.txt"), "not a page")
  archivePath = join(directory, "reader-fixture.cb7")
  solidArchivePath = join(directory, "reader-solid.cb7")
  solidNestedArchivePath = join(directory, "reader-solid-nested.cb7")
  await execFileAsync(executable.path, [
    "a", "-t7z", "-mx=1", "-ms=off", "-bd", "-bb0", "--", archivePath, "pages",
  ], { cwd: directory, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  await execFileAsync(executable.path, [
    "a", "-t7z", "-mx=1", "-ms=on", "-bd", "-bb0", "--", solidArchivePath, "pages",
  ], { cwd: directory, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  innerFixture = await createZipFixture({
    name: "inner.cbz",
    entries: [{ path: "inside/1.png", bytes: ONE_PIXEL_PNG, level: 0 }],
  })
  await writeFile(join(directory, "inner.cbz"), innerFixture.bytes)
  await writeFile(join(directory, "filler.bin"), Uint8Array.of(1, 2, 3))
  await execFileAsync(executable.path, [
    "a", "-t7z", "-mx=1", "-ms=on", "-bd", "-bb0", "--", solidNestedArchivePath, "inner.cbz", "filler.bin",
  ], { cwd: directory, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  await innerFixture?.cleanup()
})

describe.skipIf(!executable)("CB7 reader system integration", () => {
  it("[neoview.sevenzip.reader-e2e] detects, indexes, probes and streams a real CB7", async () => {
    const detected = await detectViewSource(archivePath)
    expect(detected).toEqual({ kind: "archive", path: archivePath })

    const service = new CoreReaderService(
      createPlatformReaderBookLoader(),
      new StreamingImageMetadataProbe(),
    )
    const route = new ReaderAssetRoute(service, {
      baseUrl: "http://127.0.0.1:41000",
      token: "route-token",
    })
    try {
      const session = await service.openViewSource({ kind: "path", path: archivePath })
      expect(session.book.source).toEqual({ kind: "archive", path: archivePath })
      expect(session.book.pages.map((page) => page.entryPath)).toEqual([
        "pages/2.png",
        "pages/10.png",
      ])
      expect(session.book.pages[0]?.dimensions).toEqual({ width: 1, height: 1 })

      const page = session.book.pages[0]!
      const response = (await route.handle(new Request(route.pageUrl(session.id, page.id))))!
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("image/png")
      expect(response.headers.has("accept-ranges")).toBe(false)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
    } finally {
      route.close()
      await service[Symbol.asyncDispose]()
    }
  })

  it("[neoview.sevenzip.solid-reader-e2e] reads a solid CB7 through the same Reader Core route", async () => {
    const service = new CoreReaderService(
      createPlatformReaderBookLoader(),
      new StreamingImageMetadataProbe(),
    )
    const route = new ReaderAssetRoute(service, {
      baseUrl: "http://127.0.0.1:41000",
      token: "route-token",
    })
    try {
      const session = await service.openViewSource({ kind: "path", path: solidArchivePath })
      expect(session.book.pages.map((page) => page.entryPath)).toEqual([
        "pages/2.png",
        "pages/10.png",
      ])
      expect(session.book.pages[0]?.dimensions).toEqual({ width: 1, height: 1 })
      const page = session.book.pages[1]!
      const response = (await route.handle(new Request(route.pageUrl(session.id, page.id))))!
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(ONE_PIXEL_PNG)
    } finally {
      route.close()
      await service[Symbol.asyncDispose]()
    }
  })

  it("[neoview.sevenzip.solid-nested-e2e] opens an inner CBZ through a borrowed solid materialization lease", async () => {
    const tempDirectory = join(directory, "nested-materialized")
    await mkdir(tempDirectory)
    const book = await createPlatformReaderBookLoader({ archiveTempDirectory: tempDirectory })({
      kind: "archive",
      path: solidNestedArchivePath,
      entryPath: "inner.cbz",
    })
    expect(book.source).toEqual({
      kind: "archive",
      path: solidNestedArchivePath,
      entryPaths: ["inner.cbz"],
    })
    expect(book.pages.map((page) => page.entryPath)).toEqual(["inside/1.png"])
    const source = await book.pages[0]!.content.load()
    expect(Buffer.from(await new Response(await source.open()).arrayBuffer())).toEqual(ONE_PIXEL_PNG)
    await source.close()
    await book.close()
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it("[neoview.sevenzip.solid-nested-budget] counts the entire solid layer against nested disk budget", async () => {
    const tempDirectory = join(directory, "nested-budget")
    await mkdir(tempDirectory)
    const loader = createPlatformReaderBookLoader({
      archiveTempDirectory: tempDirectory,
      maxArchiveMaterializedBytes: innerFixture!.bytes.byteLength,
    })
    await expect(loader({
      kind: "archive",
      path: solidNestedArchivePath,
      entryPath: "inner.cbz",
    })).rejects.toThrow("Nested archives require")
    expect(await readdir(tempDirectory)).toEqual([])
  })
})
