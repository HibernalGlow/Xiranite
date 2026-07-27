import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { createReaderPageTransitionStore } from "../../page-transition/ReaderPageTransitionStore"
import { PageTransitionCard } from "./PageTransitionCard"

test("[neoview.page-transition.continuous-present-editor] persists the repeated-page presentation switch", async () => {
  const persist = vi.fn(async (settings) => settings)
  const store = createReaderPageTransitionStore({ persist })
  await render(<PageTransitionCard store={store} />)

  const toggle = page.getByRole("switch", { name: "连续翻页逐页呈现" })
  await expect.element(toggle).toHaveAttribute("data-state", "checked")
  await toggle.click()
  await expect.poll(() => persist.mock.calls.length).toBe(1)
  expect(persist.mock.calls[0]?.[0]).toMatchObject({ renderEveryRepeatedPage: false })
})
