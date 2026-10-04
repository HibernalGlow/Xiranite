import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeOperationDTO } from "@xiranite/shared"
import { useNodeOperationJournal } from "@/nodes/shared/nodeOperationStore"
import { TasksView } from "./TasksView"

const rpc = vi.hoisted(() => ({
  list: vi.fn(async () => [] as NodeOperationDTO[]),
  sync: vi.fn(async () => undefined),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
}))

// TasksView talks to the node UI seam only; mocking it proves the view has no other backend path.
vi.mock("@/nodes/shared/api", () => ({
  listNodeOperations: rpc.list,
  refreshNodeOperationEvents: rpc.sync,
  pauseNodeOperation: rpc.pause,
  resumeNodeOperation: rpc.resume,
  cancelNodeOperation: rpc.cancel,
}))

afterEach(() => {
  cleanup()
  useNodeOperationJournal.getState().reset()
  rpc.list.mockReset()
  rpc.sync.mockReset()
  rpc.pause.mockReset()
  rpc.resume.mockReset()
  rpc.cancel.mockReset()
})

test("shows active ClipM progress and cancels the selected backend operation", async () => {
  const operation = operationFixture()
  useNodeOperationJournal.getState().upsertOperation(operation)
  useNodeOperationJournal.getState().appendEvent(operation.operationId, 0, { type: "progress", progress: 40, message: "GPU batch 4/10" })
  rpc.list.mockResolvedValue([operation])
  rpc.sync.mockResolvedValue(undefined)
  rpc.cancel.mockResolvedValue({ ...operation, phase: "cancelled", updatedAt: operation.updatedAt + 1 })

  await render(<div style={{ height: 720, width: 980 }}><TasksView /></div>)

  await expect.element(page.getByTestId(`clipm-task-${operation.operationId}`)).toBeVisible()
  const task = page.getByTestId(`clipm-task-${operation.operationId}`)
  await expect.element(task.getByText("GPU batch 4/10", { exact: true })).toBeVisible()
  await expect.element(task.getByText("40%", { exact: true })).toBeVisible()
  await page.getByRole("radio", { name: "全部" }).click()
  await task.getByRole("button", { name: "取消任务" }).click()
  await expect.poll(() => rpc.cancel).toHaveBeenCalledWith(operation.operationId)
  await expect.element(page.getByTestId(`clipm-task-${operation.operationId}`).getByText("取消", { exact: true })).toBeVisible()
})

function operationFixture(): NodeOperationDTO {
  return {
    operationId: "clipm-operation-1",
    nodeId: "clipm",
    phase: "running",
    createdAt: 1_728_000_000_000,
    updatedAt: 1_728_000_001_000,
    startedAt: 1_728_000_000_100,
    eventCount: 1,
    result: undefined,
  }
}
