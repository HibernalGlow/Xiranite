import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import { Progress } from "@/components/ui/progress"

afterEach(() => {
  document.body.replaceChildren()
})

function parts() {
  return {
    root: document.querySelector('[data-slot="progress"]'),
    indicator: document.querySelector<HTMLElement>('[data-slot="progress-indicator"]'),
  }
}

describe("shared Progress", () => {
  test("publishes the value it was given and moves the indicator to match", async () => {
    await render(<Progress value={25} label="完成度" />)

    const { root, indicator } = parts()
    expect(root, "Root 没渲染").toBeTruthy()
    expect(root!.getAttribute("role")).toBe("progressbar")
    expect(root!.getAttribute("aria-valuenow")).toBe("25")
    expect(root!.getAttribute("aria-label")).toBe("完成度")
    expect(indicator!.style.transform).toBe("translateX(-75%)")
  })

  test("the indicator really tracks the number (falsification for a stuck bar)", async () => {
    await render(<Progress value={100} />)
    const full = parts().indicator!.style.transform

    document.body.replaceChildren()
    await render(<Progress value={25} />)
    const quarter = parts().indicator!.style.transform

    // 浏览器会把 -0% 规格化成 0%，这里断言的是「满格」而不是符号。
    expect(full).toBe("translateX(0%)")
    expect(quarter).not.toBe(full)
  })

  test("an absent value renders an empty bar instead of NaN", async () => {
    await render(<Progress />)

    expect(parts().indicator!.style.transform).toBe("translateX(-100%)")
    expect(parts().root!.getAttribute("aria-valuenow")).toBe(null)
  })
})
