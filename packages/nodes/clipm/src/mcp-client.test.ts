import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { CLIPM_PROGRESS_DATA_MARKER, decodeClipmProgressMessage, resolveClipmPythonProjectRoot } from "./mcp-client.js"

describe("ClipM Python project resolution", () => {
  test("uses the package-local Python project during source and package execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "clipm-package-layout-"))
    const project = join(root, "package", "python")
    await createProject(project)

    await expect(resolveClipmPythonProjectRoot(
      undefined,
      pathToFileURL(join(root, "package", "dist", "mcp-client.js")).href,
    )).resolves.toBe(project)
  })

  test("uses the extracted backend asset when ClipM is bundled into one backend file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clipm-bundle-layout-"))
    const project = join(root, "backend-assets", "clipm-python")
    await createProject(project)

    await expect(resolveClipmPythonProjectRoot(
      undefined,
      pathToFileURL(join(root, "xiranite-backend.js")).href,
    )).resolves.toBe(project)
  })

  test("rejects a configured directory without a Python project", async () => {
    const root = await mkdtemp(join(tmpdir(), "clipm-missing-layout-"))
    const missing = join(root, "missing")

    await expect(resolveClipmPythonProjectRoot(missing)).rejects.toThrow(
      "ClipM Python project is unavailable",
    )
  })
})

describe("ClipM progress payloads", () => {
  test("decodes a structured work payload while preserving the visible message", () => {
    const message = `scored: book.cbz${CLIPM_PROGRESS_DATA_MARKER}{"kind":"work-score","work":{"workId":"work-1"}}`

    expect(decodeClipmProgressMessage(message)).toEqual({
      message: "scored: book.cbz",
      data: { kind: "work-score", work: { workId: "work-1" } },
    })
  })

  test("leaves ordinary and malformed progress messages untouched", () => {
    expect(decodeClipmProgressMessage("preparing pages")).toEqual({ message: "preparing pages" })
    const malformed = `scored${CLIPM_PROGRESS_DATA_MARKER}{not-json}`
    expect(decodeClipmProgressMessage(malformed)).toEqual({ message: malformed })
  })
})

async function createProject(project: string): Promise<void> {
  await mkdir(project, { recursive: true })
  await writeFile(join(project, "pyproject.toml"), "[project]\nname = \"clipm-test\"\n")
}
