import { expect, test } from "vitest"
import { render } from "vitest-browser-react"
import { ModulePanel } from "./module-panel"

test("scrolls overflowing content inside a height-constrained module panel", async () => {
  await render(
    <div style={{ height: 120 }}>
      <ModulePanel fill title="Overflow test">
        <div style={{ flex: "0 0 320px" }}>Overflowing panel content</div>
      </ModulePanel>
    </div>,
  )

  const content = document.querySelector<HTMLElement>('[data-slot="module-panel-content"]')
  expect(content).not.toBeNull()
  expect(getComputedStyle(content!).overflowY).toBe("auto")
  expect(content!.scrollHeight).toBeGreaterThan(content!.clientHeight)
  content!.scrollTo({ top: content!.scrollHeight })
  expect(content!.scrollTop).toBeGreaterThan(0)
})
