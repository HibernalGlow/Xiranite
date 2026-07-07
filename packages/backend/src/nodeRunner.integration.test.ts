import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createXiraniteNodeClient, type XiraniteNodeClient } from "@xiranite/api/client"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import type { NodeRunEventDTO } from "@xiranite/shared"
import { startBackend } from "./index.js"

const RUN_ROOT = fileURLToPath(new URL("../../../artifacts/test-runs/backend-node-runner/", import.meta.url))
const cases = new Set<string>()

let backend: Awaited<ReturnType<typeof startBackend>>
let client: XiraniteNodeClient

beforeAll(async () => {
  backend = await startBackend({
    token: "node-runner-test-token",
    repository: createMemoryWorkspaceRepository(),
  })
  client = createXiraniteNodeClient(backend.url, { token: backend.token })
})

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
})

afterAll(() => {
  backend?.close()
})

describe("backend default node runner with real node packages", () => {
  test("runs cleanf through HTTP operation stream against a real unicode directory", async () => {
    // @xiranite-real-run cleanf
    const root = await createFixture("cleanf-真实 路径")
    await writeFile(join(root, "old.bak"), "backup", "utf8")
    await mkdir(join(root, "temp_build"), { recursive: true })
    await writeFile(join(root, "temp_build", "keep.txt"), "nested", "utf8")

    const { result, events } = await runNode<CleanfData>("cleanf", {
      paths: [root],
      presets: ["backup_files", "temp_folders"],
      preview: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.totalRemoved).toBe(2)
    expect(result.data?.previewFiles).toEqual(expect.arrayContaining([
      join(root, "old.bak"),
      join(root, "temp_build"),
    ]))
    expect(events.some((event) => event.type === "progress" && event.message.includes("Scanning"))).toBe(true)
  })

  test("runs crashu plan through HTTP operation stream against real source and target folders", async () => {
    // @xiranite-real-run crashu
    const root = await createFixture("crashu-真实 路径")
    const sourceRoot = join(root, "source")
    const targetRoot = join(root, "targets")
    const destinationRoot = join(root, "destination")
    await mkdir(join(sourceRoot, "蜂蜜作品 [Alt Name]"), { recursive: true })
    await mkdir(join(targetRoot, "Alt Name"), { recursive: true })
    await mkdir(destinationRoot, { recursive: true })

    const { result, events } = await runNode<CrashuData>("crashu", {
      action: "plan",
      sourcePaths: [sourceRoot],
      targetPath: targetRoot,
      destinationPath: destinationRoot,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.similarFound).toBe(1)
    expect(result.data?.plan[0]).toEqual(expect.objectContaining({
      sourcePath: join(sourceRoot, "蜂蜜作品 [Alt Name]"),
      targetName: "Alt Name",
      destinationPath: join(destinationRoot, "Alt Name", "蜂蜜作品 [Alt Name]"),
      status: "pending",
    }))
    expect(events.some((event) => event.message === "Scanning source folders.")).toBe(true)
  })

  test("runs rawfilter plan through HTTP operation stream with real archive filenames", async () => {
    // @xiranite-real-run rawfilter
    const root = await createFixture("rawfilter-真实 路径")
    await writeFile(join(root, "蜂蜜画集 [中文].zip"), "translated", "utf8")
    await writeFile(join(root, "蜂蜜画集 [raw].zip"), "raw", "utf8")

    const { result, events } = await runNode<RawfilterData>("rawfilter", {
      action: "plan",
      path: root,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.archiveCount).toBe(2)
    expect(result.data?.duplicateGroups).toBe(1)
    expect(result.data?.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileName: "蜂蜜画集 [raw].zip",
        destination: "trash",
        status: "pending",
      }),
    ]))
    expect(events.map((event) => event.message).join("\n")).toContain("Grouped 2 archive file")
  })

  test("runs marku through HTTP operation stream against a real markdown file", async () => {
    // @xiranite-real-run marku
    const root = await createFixture("marku-真实 路径")
    const markdown = join(root, "章节 一.md")
    await writeFile(markdown, "# 标题\n## 子标题\n正文\n", "utf8")

    const { result, events } = await runNode<MarkuData>("marku", {
      action: "run",
      module: "markt",
      paths: [root],
      recursive: true,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.filesProcessed).toBe(1)
    expect(result.data?.filesChanged).toBe(1)
    expect(result.data?.diffs[0]).toEqual(expect.objectContaining({
      file: markdown,
      changed: true,
    }))
    expect(events.some((event) => event.message === "Marku completed.")).toBe(true)
  })

  test("runs repacku single-pack through HTTP operation stream against real folders", async () => {
    // @xiranite-real-run repacku
    const root = await createFixture("repacku-真实 路径")
    const album = join(root, "作品 一")
    await mkdir(album, { recursive: true })
    await writeFile(join(album, "001.png"), "png", "utf8")
    await writeFile(join(album, "002.jpg"), "jpg", "utf8")

    const { result, events } = await runNode<RepackuData>("repacku", {
      action: "single-pack",
      path: root,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.plannedCount).toBe(1)
    expect(result.data?.operations[0]).toEqual(expect.objectContaining({
      mode: "entire",
      sourcePath: album,
      status: "planned",
    }))
    expect(result.data?.operations[0]?.targetPath).toBe(join(root, "作品 一.zip"))
    expect(events.some((event) => event.message.includes("single-pack"))).toBe(true)
  })

  test("runs recycleu status through HTTP operation stream without emptying the real recycle bin", async () => {
    // @xiranite-real-run recycleu
    const { result } = await runNode<RecycleuData>("recycleu", {
      action: "status",
    })

    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
    expect(result.data?.remainingSeconds).toBe(0)
  })

  test("runs sleept status through HTTP operation stream without touching power actions", async () => {
    // @xiranite-real-run sleept
    const { result } = await runNode<SleeptData>("sleept", {
      action: "status",
      dryrun: true,
    })

    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
    expect(typeof result.data?.currentCpu).toBe("number")
  })
})

async function runNode<TData>(
  nodeId: string,
  input: unknown,
): Promise<{ result: { success: boolean; message: string; data?: TData }; events: NodeRunEventDTO[] }> {
  const events: NodeRunEventDTO[] = []
  const result = await client.runNode<unknown, TData>(nodeId, input, (event) => {
    events.push(event)
  })
  return { result, events }
}

async function createFixture(label: string): Promise<string> {
  await mkdir(RUN_ROOT, { recursive: true })
  const dir = join(RUN_ROOT, `${label}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  cases.add(dir)
  return dir
}

interface CleanfData {
  totalRemoved: number
  previewFiles: string[]
}

interface RawfilterData {
  archiveCount: number
  duplicateGroups: number
  plan: Array<{
    fileName: string
    destination: string
    status: string
  }>
}

interface CrashuData {
  similarFound: number
  plan: Array<{
    sourcePath: string
    targetName: string
    destinationPath: string
    status: string
  }>
}

interface MarkuData {
  filesProcessed: number
  filesChanged: number
  diffs: Array<{
    file: string
    changed: boolean
  }>
}

interface RepackuData {
  plannedCount: number
  operations: Array<{
    mode: string
    sourcePath: string
    targetPath: string
    status: string
  }>
}

interface RecycleuData {
  timerStatus: string
  remainingSeconds: number
}

interface SleeptData {
  timerStatus: string
  currentCpu: number
}
