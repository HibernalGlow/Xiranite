import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import { StatusMark } from "@/components/ui/status-mark"

afterEach(() => {
  document.body.replaceChildren()
})

function svg(): SVGSVGElement | null {
  return document.querySelector("svg")
}

describe("ported StatusMark", () => {
  test("renders a real ring sized as asked and names itself", async () => {
    await render(<StatusMark status="running" size={20} />)

    const node = svg()
    expect(node, "没有渲染出 svg").toBeTruthy()
    expect(node!.getBoundingClientRect().width).toBe(20)
    expect(node!.getAttribute("aria-label")).toBeTruthy()
    expect(node!.getAttribute("role")).toBe("img")
  })

  test("the label is wired to the state machine, not fixed (positive control)", async () => {
    await render(<StatusMark status="running" size={20} />)
    const running = svg()!.getAttribute("aria-label")

    document.body.replaceChildren()
    await render(<StatusMark status="failed" size={20} />)
    const failed = svg()!.getAttribute("aria-label")

    expect(failed).toBeTruthy()
    expect(failed).not.toBe(running)
  })

  test("an explicit label takes over the accessible name and the svg steps aside", async () => {
    await render(<StatusMark status="running" size={20} label="正在删除" />)

    const node = svg()
    expect(node!.hasAttribute("aria-label")).toBe(false)
    expect(node!.hasAttribute("role")).toBe(false)
    expect(document.body.textContent).toContain("正在删除")
  })

  test("a determinate progress value renders without losing the ring", async () => {
    await render(<StatusMark status="running" progress={40} size={24} />)

    expect(svg()).toBeTruthy()
    expect(svg()!.getBoundingClientRect().width).toBe(24)
  })
})
