import { useEffect, useReducer } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
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
  await page.getByRole("tab", { name: /不喜欢/ }).click()
  await expect.element(page.getByText("Demo Negative.cbz", { exact: true })).toBeVisible()
  await expect.element(page.getByText("342", { exact: true })).toBeVisible()
  expect(page.getByTestId("clipm-surface").element().scrollWidth).toBeLessThanOrEqual(page.getByTestId("clipm-surface").element().clientWidth)
})

test("applies manual feedback and resolves an identity review", async () => {
  const host = createHost({ path: "D:/Comics" })
  await render(<Harness host={host} />)

  await page.getByRole("tab", { name: "修正" }).click()
  await expect.poll(() => host.calls.some((call) => call.action === "review-list")).toBe(true)
  await expect.element(page.getByText("identity_conflict", { exact: true })).toBeVisible()

  await page.getByRole("textbox", { name: "修正作品 ID" }).fill(WORK_ID)
  await page.getByRole("button", { name: "P 喜欢" }).click()
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

const WORK_ID = "018f0000-0000-7000-8000-000000000001"
const REVIEW_ID = "018f0000-0000-7000-8000-000000000099"

type TestHost = NodeComponentProps<ClipmCardState>["host"] & {
  calls: ClipmInput[]
  stateValue: ClipmCardState
  activeVersion: number
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

function createHost(initial: ClipmCardState): TestHost {
  const host = {
    calls: [] as ClipmInput[],
    stateValue: { ...initial },
    activeVersion: 1,
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
        return { success: true, message: `${input.action} complete`, data: fixture(input, host.activeVersion) as TData }
      },
      cancelCurrent: vi.fn(async () => true),
    },
    localFiles: { pickDirectory: vi.fn(async () => "D:/Picked") },
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

function fixture(input: ClipmInput, activeVersion: number): ClipmData {
  switch (input.action) {
    case "score":
      return { action: "score", result: {
        path: "D:/Comics",
        discoveredWorkCount: 2,
        succeededWorkCount: 2,
        failedWorkCount: 0,
        feedback: { path: "D:/Comics", scannedWorkCount: 2, synchronizedWorkCount: 0, importedFeedbackCount: 0 },
        works: [work("Demo Positive.cbz", "P", 873), work("Demo Negative.cbz", "N", 342)],
      } }
    case "review-list":
      return { action: "review-list", result: { items: [{ reviewId: REVIEW_ID, kind: "identity_conflict", status: "pending", workId: WORK_ID, path: "D:/Comics/Conflict.cbz", details: {}, createdAt: "2026-08-01T00:00:00Z", resolvedAt: null }] } }
    case "feedback-apply":
      return { action: "feedback-apply", result: { work: work("Demo Positive.cbz", input.classification ?? "P", input.ranking ?? 873) } }
    case "feedback-scan":
      return { action: "feedback-scan", result: { path: input.path ?? "", scannedWorkCount: 2, synchronizedWorkCount: 1, importedFeedbackCount: 1 } }
    case "review-resolve":
      return { action: "review-resolve", result: work("Conflict.cbz", "P", 700) }
    case "train":
      return { action: "train", result: { runId: "run-2", dataRevision: 24, classification: { status: "accepted", bundleVersion: 2 }, ranking: { status: "skipped", reasons: ["not enough ranking corrections"] }, activeBundleVersion: 2 } }
    case "model-list":
      return { action: "model-list", result: { activeBundleVersion: activeVersion, models: [model(1, activeVersion === 1 ? "active" : "inactive", "accepted"), model(2, activeVersion === 2 ? "active" : "failed", "rejected")] } }
    case "model-activate":
    case "model-rollback":
      return { action: input.action, result: { previousBundleVersion: 1, activeBundleVersion: input.bundleVersion ?? activeVersion, forced: input.force ?? false } }
    case "env-status":
      return { action: "env-status", result: { healthy: true, serviceVersion: "0.1.0", runtimeRoot: "D:/clipm-runtime", pythonVersion: "3.11.9", device: "cuda", cudaAvailable: true, modelAvailable: true, modelResidency: "idle-10m", activeBundleVersion: activeVersion, databaseOk: true, sevenZipAvailable: true, rarAvailable: true, warnings: [] } }
    default:
      throw new Error(`Unhandled fixture action: ${input.action}`)
  }
}

function work(name: string, label: "P" | "N", score: number) {
  return { workId: WORK_ID + name, path: `D:/Comics/${name}`, label, score, probability: score / 1000, bundleVersion: 1, shortCode: `code-${score}`, metadataWriteStatus: "written" as const }
}

function model(bundleVersion: number, status: "active" | "inactive" | "failed", validation: "accepted" | "rejected") {
  return { bundleVersion, status, dataRevision: 24, createdAt: "2026-08-01T00:00:00Z", classificationValidationStatus: validation, classificationValidationReasons: validation === "rejected" ? ["validation degraded"] : [], rankingValidationStatus: null, rankingValidationReasons: [] }
}
