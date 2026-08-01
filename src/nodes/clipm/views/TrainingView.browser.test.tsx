import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { TrainingView } from "./TrainingView"

test("configures automatic batches while manual training stays immediate", async () => {
  const updateConfig = vi.fn(async () => true)
  const run = vi.fn(async () => ({ success: false, message: "training fixture" }))
  const controller = {
    data: {},
    running: false,
    environmentConfig: {
      loading: false,
      value: { runtime_root: "D:/ClipM", auto_train: false, auto_train_batch_size: 20 },
    },
    patch: vi.fn(),
    updateConfig,
    run,
  } as unknown as ClipmWorkspaceController
  await render(<TrainingView controller={controller} />)

  await page.getByRole("switch", { name: "自动训练" }).click()
  await expect.poll(() => updateConfig).toHaveBeenCalledWith({ auto_train: true })

  const batchSize = page.getByRole("spinbutton", { name: "自动训练批量作品数" })
  await batchSize.fill("32")
  await batchSize.element().blur()
  await expect.poll(() => updateConfig).toHaveBeenCalledWith({ auto_train_batch_size: 32 })

  await page.getByRole("button", { name: "训练并验证新头部" }).click()
  await expect.poll(() => run).toHaveBeenCalledWith({ action: "train" })
})
