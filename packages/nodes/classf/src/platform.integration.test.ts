import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runClassf } from "./core.js"
import { createNodeClassfRuntime } from "./platform.js"

describe("classf real filesystem", () => {
  const fixtures: string[] = []
  afterEach(async () => { await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

  test("copies nested files to a target root while preserving their relative paths", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "xiranite-classf-"))
    fixtures.push(fixture)
    const source = join(fixture, "source")
    const nested = join(source, "collection", "2026")
    const library = join(fixture, "library")
    const output = join(fixture, "output")
    await mkdir(nested, { recursive: true })
    await mkdir(join(library, "[Artist]"), { recursive: true })
    const archive = join(nested, "[Artist] work.zip")
    const notes = join(nested, "notes.txt")
    await writeFile(archive, "archive", "utf8")
    await writeFile(notes, "notes", "utf8")

    const plan = await runClassf({ action: "plan", paths: [source], crashuSourcePaths: [library], placementMode: "root", targetDir: output, classifyMode: "auto", transferMode: "copy", sameaIgnorePathBlacklist: true }, createNodeClassfRuntime())
    expect(plan.success).toBe(true)
    expect(plan.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: archive, targetPath: join(output, "already", "collection", "2026", "[Artist] work.zip"), status: "ready" }),
      expect.objectContaining({ sourcePath: notes, targetPath: join(output, "wait", "collection", "2026", "notes.txt"), status: "ready" }),
    ]))

    const applied = await runClassf({ action: "classify", paths: [source], crashuSourcePaths: [library], placementMode: "root", targetDir: output, classifyMode: "auto", transferMode: "copy", sameaIgnorePathBlacklist: true, dryRun: false }, createNodeClassfRuntime())
    expect(applied.success).toBe(true)
    await expect(readFile(join(output, "already", "collection", "2026", "[Artist] work.zip"), "utf8")).resolves.toBe("archive")
    await expect(readFile(join(output, "wait", "collection", "2026", "notes.txt"), "utf8")).resolves.toBe("notes")
    await expect(readFile(archive, "utf8")).resolves.toBe("archive")
  })

  test("moves each file only into already or wait below its current directory", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "xiranite-classf-local-"))
    fixtures.push(fixture)
    const source = join(fixture, "source")
    const nested = join(source, "group", "deep")
    const library = join(fixture, "library")
    await mkdir(nested, { recursive: true })
    await mkdir(join(library, "[Artist]"), { recursive: true })
    const archive = join(nested, "[Artist] work.zip")
    const notes = join(nested, "notes.txt")
    await writeFile(archive, "archive", "utf8")
    await writeFile(notes, "notes", "utf8")

    const applied = await runClassf({ action: "classify", paths: [source], crashuSourcePaths: [library], placementMode: "local", classifyMode: "auto", transferMode: "move", sameaIgnorePathBlacklist: true, dryRun: false }, createNodeClassfRuntime())
    expect(applied.success).toBe(true)
    await expect(readFile(join(nested, "already", "[Artist] work.zip"), "utf8")).resolves.toBe("archive")
    await expect(readFile(join(nested, "wait", "notes.txt"), "utf8")).resolves.toBe("notes")
    await expect(readFile(archive, "utf8")).rejects.toBeTruthy()
    await expect(readFile(notes, "utf8")).rejects.toBeTruthy()
  })
})
