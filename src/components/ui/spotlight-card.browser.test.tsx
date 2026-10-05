import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import { SpotlightCard } from "@/components/ui/spotlight-card"

afterEach(() => {
  document.body.replaceChildren()
})

function overlay(root: HTMLElement): HTMLElement {
  // 覆盖层是 root 的最后一个子元素（在 children 之后 ⇒ 盖在卡上，不被不透明底挡掉）。
  return root.lastElementChild as HTMLElement
}

describe("ported SpotlightCard as a shadcn-safe overlay wrapper", () => {
  test("the spotlight layer sits after the card content, not behind it", async () => {
    const { container } = await render(
      <SpotlightCard className="rounded-lg">
        <div data-testid="card">内容</div>
      </SpotlightCard>,
    )
    const root = container.querySelector('[data-slot="spotlight-card"]') as HTMLElement
    expect(root, "没渲染出 spotlight 根").toBeTruthy()

    // children 在前、覆盖层在后
    expect((root.firstElementChild as HTMLElement).dataset.testid).toBe("card")
    const ov = overlay(root)
    expect(ov.style.background).toContain("radial-gradient")
    expect(ov.className).toContain("pointer-events-none")
  })

  test("the default spotlight is token-driven so override-type skins recolor it", async () => {
    const { container } = await render(
      <SpotlightCard>
        <div>x</div>
      </SpotlightCard>,
    )
    const ov = overlay(container.querySelector('[data-slot="spotlight-card"]') as HTMLElement)
    expect(ov.style.background).toContain("color-mix")
    expect(ov.style.background).toContain("var(--primary)")
  })

  test("interaction raises the spotlight opacity (the motion is live, not a static div)", async () => {
    const { container } = await render(
      <SpotlightCard>
        <div>x</div>
      </SpotlightCard>,
    )
    const root = container.querySelector('[data-slot="spotlight-card"]') as HTMLElement
    expect(overlay(root).style.opacity).toBe("0")

    // React 的合成 onMouseEnter 不吃直发的原生 mouseenter（不冒泡）；用会冒泡的
    // focusin 触发 onFocus，走的是同一条 setOpacity 路径，足以证明动效接通。
    root.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(Number(overlay(root).style.opacity)).toBeGreaterThan(0)
  })
})
