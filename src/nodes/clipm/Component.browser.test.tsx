import { useEffect, useReducer } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import type { ClipmNodeConfig } from "@xiranite/node-clipm/platform"
import { Component } from "./Component"
import type { ClipmCardState } from "./types"

const surface = vi.hoisted(() => ({ height: 760, mode: "workspace", width: 1200 }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, density: "roomy", ...surface }),
}))

afterEach(() => {
  cleanup()
  Object.assign(surface, { height: 760, mode: "workspace", width: 1200 })
})

test("shows the selected score scope with a distinct toggle state", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  const library = page.getByRole("radio", { name: "整库" })
  const work = page.getByRole("radio", { name: "单本" })
  await expect.element(library).toHaveAttribute("data-state", "on")
  await expect.element(library).toHaveAttribute("aria-checked", "true")
  await expect.element(work).toHaveAttribute("data-state", "off")
  await expect.element(work).toHaveAttribute("aria-checked", "false")
  expect(window.getComputedStyle(library.element()).backgroundColor).not.toBe(window.getComputedStyle(work.element()).backgroundColor)

  await work.click()
  await expect.element(library).toHaveAttribute("data-state", "off")
  await expect.element(work).toHaveAttribute("data-state", "on")
  await expect.element(work).toHaveAttribute("aria-checked", "true")
  expect(host.stateValue.scoreScope).toBe("work")
})

test("keeps workspace modes in the title bar and expands only the active mode label", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  const titlebar = page.getByTestId("clipm-titlebar")
  expect(titlebar.element().querySelector('[role="tablist"]')).toBeTruthy()
  const scoring = page.getByRole("tab", { name: "评分" })
  const corrections = page.getByRole("tab", { name: "修正" })
  expect(scoring.element().textContent).toContain("评分")
  expect(corrections.element().textContent).not.toContain("修正")

  await corrections.click()
  await expect.element(corrections).toHaveAttribute("aria-selected", "true")
  expect(scoring.element().textContent).not.toContain("评分")
  expect(corrections.element().textContent).toContain("修正")
})

test("scores a library through the host runner and renders independent P/N groups", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await expect.element(page.getByRole("tab", { name: "评分" })).toBeVisible()
  await page.getByRole("button", { name: "评分并同步" }).click()

  await expect.poll(() => host.calls[0]).toMatchObject({
    action: "score",
    path: "D:/Comics",
    scope: "library",
    scoreOptions: { rename: true, writeMetadata: true, rescore: false, dryRun: false },
  })
  await expect.element(page.getByText("Demo Positive.cbz", { exact: true })).toBeVisible()
  await expect.element(page.getByText("873", { exact: true })).toBeVisible()
  expect(renderedWorkNames()).toEqual(["Demo Positive.cbz", "Lower Positive.cbz"])
  await page.getByRole("tab", { name: /不喜欢/ }).click()
  await expect.element(page.getByText("Demo Negative.cbz", { exact: true })).toBeVisible()
  await expect.element(page.getByText("342", { exact: true })).toBeVisible()
  expect(renderedWorkNames()).toEqual(["Higher Negative.cbz", "Demo Negative.cbz"])
  expect(page.getByTestId("clipm-surface").element().scrollWidth).toBeLessThanOrEqual(page.getByTestId("clipm-surface").element().clientWidth)
})

test("applies manual feedback and resolves an identity review", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "修正" }).click()
  await expect.poll(() => host.calls.some((call) => call.action === "review-list")).toBe(true)
  await expect.element(page.getByText("identity_conflict", { exact: true })).toBeVisible()

  await page.getByRole("textbox", { name: "修正作品 ID" }).fill(WORK_ID)
  const positive = page.getByRole("radio", { name: "P 喜欢" })
  const negative = page.getByRole("radio", { name: "N 不喜欢" })
  await positive.click()
  await expect.element(positive).toHaveAttribute("data-state", "on")
  await expect.element(negative).toHaveAttribute("data-state", "off")
  expect(window.getComputedStyle(positive.element()).backgroundColor).not.toBe(window.getComputedStyle(negative.element()).backgroundColor)
  await page.getByRole("spinbutton", { name: "人工评分" }).fill("901")
  await page.getByRole("button", { name: "保存人工修正" }).click()
  await expect.poll(() => host.calls.find((call) => call.action === "feedback-apply")).toMatchObject({
    action: "feedback-apply",
    workId: WORK_ID,
    classification: "P",
    ranking: 901,
    source: "gui",
  })
  await expect.element(page.getByText("901", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: `选择审核 ${REVIEW_ID}` }).click()
  await page.getByRole("button", { name: "确认处理" }).click()
  await expect.poll(() => host.calls.find((call) => call.action === "review-resolve")).toMatchObject({
    action: "review-resolve",
    reviewId: REVIEW_ID,
    resolution: "use_filename",
  })
})

test("shows recent feedback and confirms a synchronized undo", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "修正" }).click()
  await expect.element(page.getByText("P/N N -> P", { exact: true })).toBeVisible()
  await expect.element(page.getByText("评分 873 -> 901", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: `撤销修正 ${EVENT_ID}` }).click()
  await expect.element(page.getByRole("alertdialog")).toBeVisible()
  await page.getByRole("button", { name: "确认撤销" }).click()

  await expect.poll(() => host.calls.find((call) => call.action === "feedback-undo")).toMatchObject({
    action: "feedback-undo",
    eventId: EVENT_ID,
    source: "gui",
  })
  await expect.element(page.getByText("已撤销", { exact: true })).toBeVisible()
})

test("requires confirmation before removing one work's CM metadata", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "修正" }).click()
  await page.getByRole("textbox", { name: "移除元数据作品路径" }).fill("D:/Comics/Demo Positive [CM1P0873-4K7Q].cbz")
  await page.getByRole("button", { name: "移除 CM 元数据" }).click()
  await expect.element(page.getByRole("alertdialog")).toBeVisible()
  await page.getByRole("button", { name: "确认移除" }).click()

  await expect.poll(() => host.calls.find((call) => call.action === "work-remove-metadata")).toMatchObject({
    action: "work-remove-metadata",
    path: "D:/Comics/Demo Positive [CM1P0873-4K7Q].cbz",
  })
  await expect.element(page.getByText("D:/Comics/Demo Positive.cbz", { exact: true })).toBeVisible()
})

test("trains both heads and force-activates a failed candidate from the model view", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "训练" }).click()
  await page.getByRole("button", { name: "训练并验证新头部" }).click()
  await expect.element(page.getByText("accepted", { exact: true }).first()).toBeVisible()
  await expect.element(page.getByText("skipped", { exact: true }).first()).toBeVisible()

  await page.getByRole("tab", { name: "模型与环境" }).click()
  await expect.element(page.getByText("CUDA / CUDA ON", { exact: true })).toBeVisible()
  await expect.element(page.getByTestId("clipm-model-2")).toBeVisible()
  await page.getByRole("switch", { name: "强制激活失败候选" }).click()
  await page.getByTestId("clipm-model-2").getByRole("button", { name: "激活" }).click()

  await expect.poll(() => host.calls.find((call) => call.action === "model-activate")).toMatchObject({
    action: "model-activate",
    bundleVersion: 2,
    force: true,
  })
  await expect.poll(() => host.activeVersion).toBe(2)
})

test("keeps portrait navigation and the root surface free of horizontal overflow", async () => {
  Object.assign(surface, { height: 640, mode: "portrait", width: 360 })
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  for (const name of ["评分", "修正", "训练", "模型与环境"]) {
    await expect.element(page.getByRole("tab", { name })).toBeVisible()
  }
  const element = page.getByTestId("clipm-surface").element()
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
})

test("provisions a chosen external runtime only after explicit setup", async () => {
  const host = createHost({}, null)
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "模型与环境" }).click()
  await expect.element(page.getByText("需要设置外置运行目录", { exact: true })).toBeVisible()
  expect(host.calls).toEqual([])

  await page.getByRole("button", { name: "设置环境" }).click()
  await page.getByRole("button", { name: "选择 ClipM 运行目录" }).click()
  await page.getByRole("radio", { name: "CPU" }).click()
  await page.getByRole("checkbox").click()
  await page.getByRole("button", { name: "创建并检查" }).click()

  await expect.poll(() => host.nodeConfig).toMatchObject({ runtime_root: "E:/ClipM", device: "cpu" })
  await expect.poll(() => host.calls.map((call) => call.action)).toEqual(["env-configure", "model-list"])
  await expect.element(page.getByText("CPU / CUDA OFF", { exact: true })).toBeVisible()
})

test("migrates an existing runtime before showing the new configured root", async () => {
  const host = createHost({}, { runtime_root: "D:/clipm-runtime", device: "cuda" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "模型与环境" }).click()
  await expect.element(page.getByText("CUDA / CUDA ON", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "迁移环境" }).click()
  await page.getByRole("button", { name: "选择 ClipM 运行目录" }).click()
  await page.getByRole("button", { name: "迁移并切换" }).click()

  await expect.poll(() => host.calls.find((call) => call.action === "env-migrate")).toMatchObject({
    action: "env-migrate",
    targetRuntimeRoot: "E:/ClipM",
  })
  await expect.poll(() => host.nodeConfig?.runtime_root).toBe("E:/ClipM")
  await expect.element(page.getByText("E:/ClipM", { exact: true }).first()).toBeVisible()
})

const WORK_ID = "018f0000-0000-7000-8000-000000000001"
const REVIEW_ID = "018f0000-0000-7000-8000-000000000099"
const EVENT_ID = "018f0000-0000-7000-8000-000000000010"
const UNDO_EVENT_ID = "018f0000-0000-7000-8000-000000000011"

type TestHost = NodeComponentProps<ClipmCardState, ClipmNodeConfig>["host"] & {
  calls: ClipmInput[]
  stateValue: ClipmCardState
  activeVersion: number
  feedbackUndone: boolean
  nodeConfig?: ClipmNodeConfig
  notify(): void
}

function Harness({ host }: { host: TestHost }) {
  const [, force] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    host.notify = force
    return () => { host.notify = () => undefined }
  }, [host])
  return <div style={{ height: surface.height, width: surface.width }}><Component compId="clipm-browser" host={host} /></div>
}

const DEFAULT_NODE_CONFIG: ClipmNodeConfig = { runtime_root: "D:/clipm-runtime", device: "cuda" }

function createHost(initial: ClipmCardState, nodeConfig: ClipmNodeConfig | null = DEFAULT_NODE_CONFIG): TestHost {
  const host = {
    calls: [] as ClipmInput[],
    stateValue: { ...initial },
    activeVersion: 1,
    feedbackUndone: false,
    nodeConfig: nodeConfig ?? undefined,
    notify: () => undefined,
    state: {
      getData: () => host.stateValue,
      patchData: (patch: Partial<ClipmCardState>) => {
        host.stateValue = { ...host.stateValue, ...patch }
        host.notify()
      },
    },
    runner: {
      run: async <TInput, TData>(_nodeId: string, rawInput: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        const input = rawInput as ClipmInput
        host.calls.push(input)
        onEvent?.({ type: "progress", progress: 45, message: `running ${input.action}` })
        if (input.action === "model-activate") host.activeVersion = input.bundleVersion ?? host.activeVersion
        if (input.action === "feedback-undo") host.feedbackUndone = true
        if (input.action === "env-migrate") host.nodeConfig = { ...host.nodeConfig, runtime_root: input.targetRuntimeRoot }
        if (input.action === "env-configure") host.nodeConfig = { ...host.nodeConfig, runtime_root: input.targetRuntimeRoot, device: input.device }
        return { success: true, message: `${input.action} complete`, data: fixture(input, host.activeVersion, host.feedbackUndone, host.nodeConfig) as TData }
      },
      cancelCurrent: vi.fn(async () => true),
    },
    localFiles: { pickDirectory: vi.fn(async () => "E:/ClipM") },
    config: {
      get: async <T,>() => ({ config: host.nodeConfig as T | undefined, path: "D:/config/xiranite.config.toml" }),
      save: async <T,>(config: T) => { host.nodeConfig = { ...host.nodeConfig, ...(config as ClipmNodeConfig) } },
    },
    getData: <T,>() => host.stateValue as T,
    patchData: (_compId: string, patch: Partial<ClipmCardState>) => {
      host.stateValue = { ...host.stateValue, ...patch }
      host.notify()
    },
    listComponents: () => [],
    updateComponent: () => undefined,
  } as unknown as TestHost
  return host
}

function fixture(input: ClipmInput, activeVersion: number, feedbackUndone: boolean, config?: ClipmNodeConfig): ClipmData {
  switch (input.action) {
    case "score":
      return { action: "score", result: {
        path: "D:/Comics",
        discoveredWorkCount: 4,
        succeededWorkCount: 4,
        failedWorkCount: 0,
        feedback: { path: "D:/Comics", scannedWorkCount: 4, synchronizedWorkCount: 0, importedFeedbackCount: 0 },
        works: [
          work("Lower Positive.cbz", "P", 500),
          work("Demo Negative.cbz", "N", 342),
          work("Demo Positive.cbz", "P", 873),
          work("Higher Negative.cbz", "N", 901),
        ],
      } }
    case "review-list":
      return { action: "review-list", result: { items: [{ reviewId: REVIEW_ID, kind: "identity_conflict", status: "pending", workId: WORK_ID, path: "D:/Comics/Conflict.cbz", details: {}, createdAt: "2026-08-01T00:00:00Z", resolvedAt: null }] } }
    case "feedback-apply":
      return { action: "feedback-apply", result: { work: work("Demo Positive.cbz", input.classification ?? "P", input.ranking ?? 873) } }
    case "feedback-list":
      return { action: "feedback-list", result: { events: [
        feedbackEvent(EVENT_ID, "N", "P", 873, 901, feedbackUndone ? UNDO_EVENT_ID : null),
        ...(feedbackUndone ? [feedbackEvent(UNDO_EVENT_ID, "P", "N", 901, 873, null)] : []),
      ], hasMore: false, nextBeforeOccurredAt: null, nextBeforeEventId: null } }
    case "feedback-undo":
      return { action: "feedback-undo", result: { work: work("Demo Positive.cbz", "N", 873) } }
    case "work-remove-metadata":
      return { action: "work-remove-metadata", result: { originalPath: input.path ?? "", finalPath: "D:/Comics/Demo Positive.cbz", workId: WORK_ID, databaseRemoved: true, metadataRemoved: true, renamed: true } }
    case "feedback-scan":
      return { action: "feedback-scan", result: { path: input.path ?? "", scannedWorkCount: 2, synchronizedWorkCount: 1, importedFeedbackCount: 1 } }
    case "review-resolve":
      return { action: "review-resolve", result: work("Conflict.cbz", "P", 700) }
    case "train":
      return { action: "train", result: { runId: "run-2", dataRevision: 24, classification: { status: "accepted", bundleVersion: 2 }, ranking: { status: "skipped", reasons: ["not enough ranking corrections"] }, activeBundleVersion: 2 } }
    case "train-auto":
      return { action: "train-auto", result: { status: "not_ready", batchSize: input.batchSize ?? 20, pendingWorkCount: 0 } }
    case "model-list":
      return { action: "model-list", result: { activeBundleVersion: activeVersion, models: [model(1, activeVersion === 1 ? "active" : "inactive", "accepted"), model(2, activeVersion === 2 ? "active" : "failed", "rejected")] } }
    case "model-activate":
    case "model-rollback":
      return { action: input.action, result: { previousBundleVersion: 1, activeBundleVersion: input.bundleVersion ?? activeVersion, forced: input.force ?? false } }
    case "env-status":
      return { action: "env-status", result: status(config?.runtime_root ?? "D:/clipm-runtime", config?.device ?? "cuda", activeVersion) }
    case "env-configure":
      return { action: "env-configure", result: status(input.targetRuntimeRoot ?? "E:/ClipM", input.device ?? "cuda", activeVersion) }
    case "env-migrate": {
      const targetRoot = input.targetRuntimeRoot ?? "E:/ClipM"
      return { action: "env-migrate", result: { sourceRuntimeRoot: "D:/clipm-runtime", targetRuntimeRoot: targetRoot, sourceStatus: status("D:/clipm-runtime", config?.device ?? "cuda", activeVersion), targetStatus: status(targetRoot, config?.device ?? "cuda", activeVersion), pythonEnvironmentRecreated: true, copiedComponents: ["database", "models"] } }
    }
    default:
      throw new Error(`Unhandled fixture action: ${input.action}`)
  }
}

function status(runtimeRoot: string, device: "cuda" | "cpu", activeVersion: number) {
  return { healthy: true, serviceVersion: "0.1.0", runtimeRoot, pythonVersion: "3.11.9", device, cudaAvailable: device === "cuda", modelAvailable: true, modelResidency: "idle-10m" as const, activeBundleVersion: activeVersion, databaseOk: true, sevenZipAvailable: true, rarAvailable: true, warnings: [] }
}

function work(name: string, label: "P" | "N", score: number) {
  return { workId: WORK_ID + name, path: `D:/Comics/${name}`, label, score, probability: score / 1000, bundleVersion: 1, shortCode: `code-${score}`, metadataWriteStatus: "written" as const }
}

function feedbackEvent(eventId: string, before: "P" | "N", after: "P" | "N", rankingBefore: number, rankingAfter: number, undoneBy: string | null) {
  return { eventId, occurredAt: "2026-08-01T00:00:00Z", source: "gui" as const, classificationBefore: before, classificationAfter: after, rankingBefore, rankingAfter, undoneBy, workId: WORK_ID, currentPath: "D:/Comics/Demo Positive.cbz", undoApplicable: undoneBy === null }
}

function model(bundleVersion: number, status: "active" | "inactive" | "failed", validation: "accepted" | "rejected") {
  return { bundleVersion, status, dataRevision: 24, createdAt: "2026-08-01T00:00:00Z", classificationValidationStatus: validation, classificationValidationReasons: validation === "rejected" ? ["validation degraded"] : [], rankingValidationStatus: null, rankingValidationReasons: [] }
}

function renderedWorkNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="clipm-work-"]')]
    .map((row) => row.querySelector<HTMLElement>("td:nth-child(2) > div > div > div")?.textContent ?? "")
}
