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

  test("moves extracted work folders as units and groups them by artist", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "xiranite-classf-folders-"))
    fixtures.push(fixture)
    const source = join(fixture, "source")
    const library = join(fixture, "library")
    const first = join(source, "[Artist] first work")
    const second = join(source, "[Artist] second work")
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await mkdir(join(library, "[Artist]"), { recursive: true })
    await writeFile(join(first, "001.jpg"), "first", "utf8")
    await writeFile(join(second, "001.png"), "second", "utf8")

    const applied = await runClassf({
      action: "classify",
      paths: [source],
      crashuSourcePaths: [library],
      placementMode: "local",
      workItemMode: "folders",
      transferMode: "move",
      sameaGroupEnabled: true,
      sameaGroupMinOccurrences: 2,
      sameaIgnorePathBlacklist: true,
      dryRun: false,
    }, createNodeClassfRuntime())

    expect(applied.success).toBe(true)
    expect(applied.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: "[Artist] first work", kind: "folder", stage: "already", status: "moved" }),
      expect.objectContaining({ sourceName: "[Artist] second work", kind: "folder", stage: "already", status: "moved" }),
    ]))
    await expect(readFile(join(source, "already", "[Artist]", "[Artist] first work", "001.jpg"), "utf8")).resolves.toBe("first")
    await expect(readFile(join(source, "already", "[Artist]", "[Artist] second work", "001.png"), "utf8")).resolves.toBe("second")
    await expect(readFile(join(first, "001.jpg"), "utf8")).rejects.toBeTruthy()
  })

  test("classifies archive files and extracted folders together in mixed mode", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "xiranite-classf-mixed-"))
    fixtures.push(fixture)
    const source = join(fixture, "source")
    const library = join(fixture, "library")
    const folderWork = join(source, "[Artist] folder work")
    const archiveWork = join(source, "[Artist] archive work.zip")
    await mkdir(folderWork, { recursive: true })
    await mkdir(join(library, "[Artist]"), { recursive: true })
    await writeFile(join(folderWork, "001.jpg"), "folder", "utf8")
    await writeFile(archiveWork, "archive", "utf8")

    const applied = await runClassf({
      action: "classify",
      paths: [source],
      crashuSourcePaths: [library],
      placementMode: "local",
      workItemMode: "mixed",
      transferMode: "move",
      sameaGroupEnabled: true,
      sameaGroupMinOccurrences: 2,
      sameaIgnorePathBlacklist: true,
      dryRun: false,
    }, createNodeClassfRuntime())

    expect(applied.success).toBe(true)
    expect(applied.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceName: "[Artist] folder work", kind: "folder", stage: "already", status: "moved" }),
      expect.objectContaining({ sourceName: "[Artist] archive work.zip", kind: "file", stage: "already", status: "moved" }),
    ]))
    await expect(readFile(join(source, "already", "[Artist]", "[Artist] folder work", "001.jpg"), "utf8")).resolves.toBe("folder")
    await expect(readFile(join(source, "already", "[Artist]", "[Artist] archive work.zip"), "utf8")).resolves.toBe("archive")
  })
})
