import { afterEach, expect, test, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import { useEffect, useReducer } from "react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { MarkuData, MarkuInput, MarkuWorkflow, MarkuWorkflowLibrary } from "@xiranite/node-marku/core"
import { Component } from "./Component"
import type { MarkuCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1280, height: 800, mode: "regular" }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(() => {
  cleanup()
  Object.assign(surface, { width: 1280, height: 800, mode: "regular" })
  vi.restoreAllMocks()
})

test("switches Normal to Workflow with a seeded draft, collapses the sidebar, and returns", async () => {
  const host = createHost({ module: "content_replace", configText: '{"mode":"literal"}', pathText: "D:/docs" })

  await render(<Harness compId="marku-mode-browser" host={host} />)
  await page.getByRole("button", { name: "工作流模式" }).click()

  await expect.element(page.getByTestId("marku-workflow-panel")).toBeVisible()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).toBeVisible()
  expect(host.state.mode).toBe("workflow")
  expect(host.state.activeWorkflowId).toBe("")
  expect(host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace"])
  expect(host.state.workflowDraft?.steps[0]?.config).toEqual({ mode: "literal" })

  // The canvas owns the whole card once the sidebar is collapsed.
  await page.getByRole("button", { name: "收起侧栏" }).click()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).not.toBeInTheDocument()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()
  await page.getByRole("button", { name: "展开侧栏" }).click()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).toBeVisible()

  await page.getByRole("button", { name: "返回普通模式" }).click()
  await expect.element(page.getByRole("button", { name: "工作流模式" })).toBeVisible()
  expect(host.state.mode).toBe("normal")
  expect(host.state.workflowDraft?.steps).toHaveLength(1)
})

test("edits steps through the sidebar list and directly on the canvas node, then dry-runs", async () => {
  const host = createHost({ module: "markt", inputText: "# Hello\n\nWorld" }, { runData: workflowRunFixture })

  await render(<Harness compId="marku-graph-browser" host={host} />)
  await page.getByRole("button", { name: "工作流模式" }).click()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()

  await page.getByRole("button", { name: "添加步骤" }).click()
  await expect.poll(() => host.state.workflowDraft?.steps.length).toBe(2)
  await expect.poll(() => document.querySelectorAll(".react-flow__edge").length).toBe(1)

  // The newly added step is selected; edit module and config on the node itself.
  const stepId = host.state.workflowDraft!.steps[1]!.id
  const node = page.getByTestId(`marku-flow-node-${stepId}`)
  await expect.element(node).toBeVisible()
  await node.getByRole("combobox").click()
  await page.getByRole("option", { name: "替换" }).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["markt", "content_replace"])

  await page.getByRole("button", { name: "编辑步骤配置" }).click()
  await page.getByRole("textbox", { name: "marku workflow node config" }).fill('{"mode":"regex"}')
  await expect.poll(() => host.state.workflowDraft?.steps[1]?.config).toEqual({ mode: "regex" })
  await userEvent.keyboard("{Escape}")
  await expect.element(page.getByRole("textbox", { name: "marku workflow step config" })).toHaveValue('{"mode":"regex"}')

  // Keyboard-accessible list controls reorder the same draft projected by the canvas.
  await page.getByRole("button", { name: "下移步骤" }).nth(0).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])
  await expect.element(page.getByTestId(`marku-flow-node-${stepId}`)).toHaveAttribute("data-step-index", "0")
  await page.getByRole("button", { name: "上移步骤" }).nth(1).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["markt", "content_replace"])
  await page.getByRole("button", { name: "下移步骤" }).nth(0).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])
  await page.getByRole("button", { name: "复制步骤" }).nth(0).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "content_replace", "markt"])
  await page.getByRole("button", { name: "删除步骤" }).nth(1).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])

  await page.getByRole("button", { name: "预演工作流" }).click()
  await expect.poll(() => host.runCalls.length).toBe(1)
  const call = host.runCalls[0]!
  expect(call.nodeId).toBe("marku")
  expect(call.input.action).toBe("workflow")
  expect(call.input.inputText).toBe("# Hello\n\nWorld")
  const submittedWorkflow = call.input.workflow as MarkuWorkflow
  expect(submittedWorkflow.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])

  const workflowResults = page.getByTestId("marku-workflow-results")
  await expect.element(workflowResults).toBeVisible()
  await expect.element(workflowResults.getByText("input.md")).toBeVisible()
  await expect.element(page.getByText("有变更")).toBeVisible()
  expect(host.state.workflowRun?.workflowId).toBe(submittedWorkflow.id)

  const firstNodeDiff = page.getByTestId(`marku-flow-node-diff-${stepId}`)
  await expect.element(firstNodeDiff).toBeVisible()
  await expect.element(firstNodeDiff).toHaveTextContent("1/1 变更")
  await expect.poll(() => document.querySelector(`[data-testid="marku-flow-node-diff-${stepId}"] [data-diff-type="delete"]`)?.textContent).toContain("# Hello")
  await expect.poll(() => document.querySelector(`[data-testid="marku-flow-node-diff-${stepId}"] [data-diff-type="insert"]`)?.textContent).toContain("- Hello")

  // The canvas keeps per-step diffs visible without the editing sidebar.
  await page.getByRole("button", { name: "收起侧栏" }).click()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).not.toBeInTheDocument()
  await expect.element(firstNodeDiff).toBeVisible()
  await expect.element(page.getByRole("combobox", { name: "marku workflow canvas result source" })).toHaveTextContent("input.md")
  await page.getByRole("button", { name: "展开侧栏" }).click()

  await page.getByRole("tab", { name: "输入" }).click()
  await expect.element(page.getByTestId("marku-workflow-step-input")).toHaveTextContent("# Hello")
  await page.getByRole("button", { name: "复制步骤输入" }).click()
  expect(host.clipboardWrites.at(-1)).toBe("# Hello\n\nWorld")

  await page.getByRole("button", { name: "步骤 2 Markt" }).click()
  await expect.element(page.getByTestId("marku-workflow-step-input")).toHaveTextContent("- Hello")
  await page.getByRole("tab", { name: "输出" }).click()
  await expect.element(page.getByTestId("marku-workflow-step-output")).toHaveTextContent("1. Hello")
  await page.getByRole("button", { name: "复制步骤输出" }).click()
  expect(host.clipboardWrites.at(-1)).toBe("1. Hello\n\nWorld")

  await page.getByRole("tab", { name: "最终差异" }).click()
  await expect.element(workflowResults.getByText("input.md")).toBeVisible()
  await page.getByRole("button", { name: "复制文件差异" }).click()
  expect(host.clipboardWrites.at(-1)).toContain("+1. Hello")
})

test("loads, renames, saves, and deletes workflows in the library", async () => {
  const saved: MarkuWorkflow = { id: "wf-saved", name: "清理流程", steps: [{ id: "step-a", module: "content_dedup", config: {} }] }
  const host = createHost(
    {
      mode: "workflow",
      workflowDraft: { id: "wf-local", name: "", steps: [{ id: "step-local", module: "markt", config: {} }] },
      activeWorkflowId: "",
    },
    { workflowLibrary: { schemaVersion: 1, workflows: [saved] } },
  )

  await render(<Harness compId="marku-library-browser" host={host} />)
  const librarySelect = page.getByRole("combobox", { name: "marku workflow library" })
  await expect.element(librarySelect).toBeEnabled()
  await librarySelect.click()
  await page.getByRole("option", { name: "清理流程" }).click()
  await expect.poll(() => host.state.activeWorkflowId).toBe("wf-saved")
  expect(host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_dedup"])

  // Invalid JSON remains local and cannot overwrite the saved workflow.
  const configEditor = page.getByRole("textbox", { name: "marku workflow step config" })
  const saveCountBeforeInvalidEdit = host.saveCalls.length
  await configEditor.fill("{invalid")
  await expect.element(page.getByText("JSON 无效，修正后才会保存到步骤。")).toBeVisible()
  await waitForLibraryDebounce()
  expect(host.saveCalls).toHaveLength(saveCountBeforeInvalidEdit)
  expect(host.state.workflowDraft?.steps[0]?.config).toEqual({})

  await configEditor.fill('{"paragraph":true}')
  await expect.poll(() => host.saveCalls.length, { timeout: 3_000 }).toBeGreaterThan(saveCountBeforeInvalidEdit)
  expect(lastLibrary(host).workflows[0]?.steps[0]?.config).toEqual({ paragraph: true })

  // Draft renames flow back into the saved entry after the debounce window.
  await page.getByRole("textbox", { name: "marku workflow name" }).fill("清理流程 v2")
  const saveCountBeforeRename = host.saveCalls.length
  await expect.poll(() => host.saveCalls.length, { timeout: 3_000 }).toBeGreaterThan(saveCountBeforeRename)
  expect(lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])

  await page.getByRole("button", { name: "复制工作流" }).click()
  await expect.poll(() => lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2", "清理流程 v2 副本"])
  await page.getByRole("button", { name: "删除工作流" }).click()
  await expect.poll(() => lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])

  await page.getByRole("button", { name: "新建工作流" }).click()
  await expect.poll(() => host.state.activeWorkflowId).toBe("")
  await page.getByRole("button", { name: "保存到库" }).click()
  await expect.poll(() => lastLibrary(host).workflows.length).toBe(2)
  expect(lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2", "未命名工作流"])
  await expect.poll(() => host.state.activeWorkflowId).not.toBe("")

  // A pending rename must not resurrect a workflow deleted before the debounce fires.
  await page.getByRole("textbox", { name: "marku workflow name" }).fill("即将删除")
  await page.getByRole("button", { name: "删除工作流" }).click()
  await expect.poll(() => lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])
  await waitForLibraryDebounce()
  expect(lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])
  expect(host.state.activeWorkflowId).toBe("")
  expect(host.state.workflowDraft?.steps).toHaveLength(1)
})

test("rehydrates a saved workflow draft after remount", async () => {
  const configStore: TestConfigStore = { value: {} }
  const firstHost = createHost({ module: "title_convert", configText: '{"offset":2}' }, { configStore })

  const firstView = await render(<Harness compId="marku-persist-first" host={firstHost} />)
  await page.getByRole("button", { name: "工作流模式" }).click()
  await page.getByRole("textbox", { name: "marku workflow name" }).fill("重挂载流程")
  await page.getByRole("button", { name: "保存到库" }).click()
  await expect.poll(() => firstHost.state.activeWorkflowId).not.toBe("")
  await expect.poll(() => (configStore.value.workflowLibrary as MarkuWorkflowLibrary | undefined)?.workflows.length).toBe(1)
  const workflowId = firstHost.state.activeWorkflowId!

  await firstView.unmount()
  const secondHost = createHost({ mode: "workflow", activeWorkflowId: workflowId }, { configStore })
  await render(<Harness compId="marku-persist-second" host={secondHost} />)

  await expect.poll(() => secondHost.state.workflowDraft?.name).toBe("重挂载流程")
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()
  expect(secondHost.state.workflowDraft?.steps[0]).toMatchObject({ module: "title_convert", config: { offset: 2 } })
  await expect.element(page.getByRole("combobox", { name: "marku workflow library" })).toHaveTextContent("重挂载流程")
})

test("confirms a real workflow write-back before execution", async () => {
  const workflow: MarkuWorkflow = {
    id: "wf-write",
    name: "写回流程",
    steps: [{ id: "step-write", module: "markt", config: {} }],
  }
  const host = createHost({ mode: "workflow", workflowDraft: workflow, pathText: "D:/docs/readme.md", dryRun: false })

  await render(<Harness compId="marku-write-browser" host={host} />)
  await page.getByRole("button", { name: "真实写回工作流" }).click()
  await expect.element(page.getByText("确认真实写回 Marku？")).toBeVisible()
  expect(host.runCalls).toHaveLength(0)

  await page.getByRole("button", { name: "确认执行" }).click()
  await expect.poll(() => host.runCalls.length).toBe(1)
  expect(host.runCalls[0]?.input).toMatchObject({ action: "workflow", dryRun: false, paths: ["D:/docs/readme.md"] })
})

type TestHost = NodeHostApi & {
  state: MarkuCardState
  runCalls: Array<{ nodeId: string; input: MarkuInput }>
  saveCalls: unknown[]
  clipboardWrites: string[]
  notify: () => void
}

type TestConfigStore = {
  value: Record<string, unknown>
}

/**
 * Marku reads host.getData on every render without subscribing, so the test
 * host bumps a version in the harness after each patch to drive re-renders
 * the way the production workspace store does.
 */
function Harness({ compId, host }: { compId: string; host: TestHost }) {
  const [, force] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    host.notify = force
    return () => {
      host.notify = () => undefined
    }
  }, [host])
  return (
    // The workspace gives cards a concrete size; without it the flex-1 canvas
    // row would collapse to zero height once the sidebar is hidden.
    <div style={{ width: 1240, height: 780 }}>
      <Component compId={compId} host={host} />
    </div>
  )
}

function createHost(initial: MarkuCardState, options: {
  configStore?: TestConfigStore
  runData?: MarkuData
  workflowLibrary?: MarkuWorkflowLibrary
} = {}): TestHost {
  const configStore = options.configStore ?? {
    value: options.workflowLibrary ? { workflowLibrary: options.workflowLibrary } : {},
  }
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    saveCalls: [],
    clipboardWrites: [],
    notify: () => undefined,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
      host.notify()
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    clipboard: {
      readText: async () => "",
      writeText: async (text) => {
        host.clipboardWrites.push(text)
      },
    },
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        const markuInput = input as MarkuInput
        host.runCalls.push({ nodeId, input: markuInput })
        return { success: true, message: "工作流已完成。", data: bindWorkflowRunToInput(options.runData, markuInput) as TData }
      },
    },
    env: { theme: "light", platform: "web" },
    getNodeConfig: async <T,>() => ({
      config: (Object.keys(configStore.value).length ? configStore.value : undefined) as T | undefined,
      path: "D:/config/xiranite.config.toml",
    }),
    saveNodeConfig: async <T,>(config: T) => {
      host.saveCalls.push(config)
      configStore.value = { ...configStore.value, ...(config as Record<string, unknown>) }
    },
  }
  return host
}

function lastLibrary(host: TestHost): MarkuWorkflowLibrary {
  const last = host.saveCalls.at(-1) as { workflowLibrary: MarkuWorkflowLibrary }
  return last.workflowLibrary
}

async function waitForLibraryDebounce() {
  await new Promise((resolve) => setTimeout(resolve, 750))
}

function bindWorkflowRunToInput(data: MarkuData | undefined, input: MarkuInput): MarkuData | undefined {
  const workflow = input.workflow as MarkuWorkflow | undefined
  if (!data?.workflow || !workflow) return data
  return {
    ...data,
    workflow: {
      ...data.workflow,
      workflowId: workflow.id,
      workflowName: workflow.name,
      sources: data.workflow.sources.map((source) => ({
        ...source,
        steps: source.steps.map((step, index) => ({
          ...step,
          stepId: workflow.steps[index]?.id ?? step.stepId,
        })),
      })),
    },
  }
}

const workflowRunFixture: MarkuData = {
  filesProcessed: 1,
  filesChanged: 1,
  inputText: "# Hello\n\nWorld",
  outputText: "1. Hello\n\nWorld",
  diffText: "--- a/input.md\n+++ b/input.md\n@@ -1 +1 @@\n-# Hello\n+1. Hello\n",
  diffs: [{ file: "input.md", diff: "-# Hello\n+1. Hello", changed: true }],
  history: [],
  undoId: "",
  errors: [],
  workflow: {
    workflowId: "wf-run",
    workflowName: "",
    stepCount: 2,
    sources: [
      {
        sourceId: "input.md",
        sourceLabel: "input.md",
        originalText: "# Hello\n\nWorld",
        outputText: "1. Hello\n\nWorld",
        steps: [
          { stepId: "s1", module: "content_replace", inputText: "# Hello\n\nWorld", outputText: "- Hello\n\nWorld", changed: true },
          { stepId: "s2", module: "markt", inputText: "- Hello\n\nWorld", outputText: "1. Hello\n\nWorld", changed: true },
        ],
      },
    ],
  },
}
