import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { useContextMenu } from "./context"
import { ContextMenuProvider } from "./ContextMenuProvider"

test("[context-menu.confirm-outcome] resolves explicit confirmation and cancellation", async () => {
  const settled = vi.fn()
  await render(<ContextMenuProvider><ConfirmationProbe onSettled={settled} /></ContextMenuProvider>)

  await page.getByRole("button", { name: "Request delete" }).click()
  await page.getByRole("button", { name: "Keep file" }).click()
  await expect.poll(() => settled).toHaveBeenLastCalledWith(false)

  await page.getByRole("button", { name: "Request delete" }).click()
  await page.getByRole("button", { name: "Delete file" }).click()
  await expect.poll(() => settled).toHaveBeenLastCalledWith(true)
})

function ConfirmationProbe({ onSettled }: { onSettled(confirmed: boolean): void }) {
  const contextMenu = useContextMenu()
  return <button type="button" onClick={() => {
    void contextMenu?.confirm({
      label: "Delete file",
      destructive: true,
      confirm: { title: "Delete file?", confirmLabel: "Delete file", cancelLabel: "Keep file" },
    }).then(onSettled)
  }}>Request delete</button>
}
