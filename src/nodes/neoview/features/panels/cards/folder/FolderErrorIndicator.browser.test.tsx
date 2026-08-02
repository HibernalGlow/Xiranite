import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { FolderErrorIndicator } from "./FolderBrowserPaneView"

test("[neoview.folder.error-indicator-gui] renders outside an ambient tooltip provider and retries", async () => {
  const onRetry = vi.fn()

  await render(
    <FolderErrorIndicator
      error="评分已保存，但路径记录同步失败"
      canRetry
      loading={false}
      onRetry={onRetry}
    />,
  )

  const button = page.getByRole("button", { name: /评分已保存，但路径记录同步失败/ })
  await expect.element(button).toBeVisible()
  await button.click()
  expect(onRetry).toHaveBeenCalledOnce()
})
