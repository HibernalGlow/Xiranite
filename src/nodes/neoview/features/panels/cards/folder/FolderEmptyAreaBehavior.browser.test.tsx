import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { FolderReturnFooter } from "./FolderEmptyAreaBehavior"

test("[neoview.folder.return-footer-gui] activates the parent-directory control through its visible button", async () => {
  const onReturn = vi.fn()
  await render(<FolderReturnFooter context={{ disabled: false, onReturn }} />)

  await page.getByRole("button", { name: "点击返回上级目录" }).click()

  await expect.poll(() => onReturn).toHaveBeenCalledOnce()
})
