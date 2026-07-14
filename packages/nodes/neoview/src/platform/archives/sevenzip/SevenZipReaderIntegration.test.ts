import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CoreReaderService } from "../../../application/reader/ReaderService.js"
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

beforeAll(async () => {
  if (!executable) return
  directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-cb7-"))
  await mkdir(join(directory, "pages"))
  await writeFile(join(directory, "pages", "10.png"), ONE_PIXEL_PNG)
  await writeFile(join(directory, "pages", "2.png"), ONE_PIXEL_PNG)
  await writeFile(join(directory, "pages", "readme.txt"), "not a page")
  archivePath = join(directory, "reader-fixture.cb7")
  await execFileAsync(executable.path, [
    "a", "-t7z", "-mx=1", "-ms=off", "-bd", "-bb0", "--", archivePath, "pages",
  ], { cwd: directory, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
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
})
