import { afterEach, describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

import { Magnet } from "@/components/ui/magnet"

afterEach(() => {
  document.body.replaceChildren()
})

function wrapper(): HTMLDivElement | null {
  return document.querySelector("div[data-magnet-probe]")
}

/** 位移落在内层 div 上（外层只负责 position:relative），尺要对着真正会动的那一层。 */
function pulled(): HTMLElement | null {
  return wrapper()!.querySelector("div") as HTMLElement | null
}

async function renderButton(onClick: () => void) {
  await render(
    <Magnet magnetStrength={6} padding={24} wrapperClassName="inline-flex" data-magnet-probe="">
      <button type="button" aria-label="复制" onClick={onClick}>
        C
      </button>
    </Magnet>,
  )
}

describe("ported Magnet around a toolbar button", () => {
  test("the button survives the wrapper and its click still lands", async () => {
    const onClick = vi.fn()
    await renderButton(onClick)

    const button = document.querySelector<HTMLButtonElement>('button[aria-label="复制"]')
    expect(button, "Magnet 把按钮吃掉了").toBeTruthy()

    button!.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test("it rests until the pointer actually comes near (no idle animation)", async () => {
    await renderButton(() => undefined)
    await new Promise(r => setTimeout(r, 30))

    expect(pulled()!.style.transform).toMatch(/translate3d\(0px, 0px, 0/)
  })

  test("a nearby pointer moves the inner layer, and leaving it hands control back", async () => {
    await renderButton(() => undefined)

    const button = document.querySelector<HTMLButtonElement>('button[aria-label="复制"]')!
    const box = button.getBoundingClientRect()
    const layer = pulled()!

    document.dispatchEvent(new MouseEvent("mousemove", {
      clientX: box.left + box.width / 2 + 6,
      clientY: box.top + box.height / 2 + 4,
      bubbles: true,
    }))
    await new Promise(r => setTimeout(r, 40))
    const pulledValue = layer.style.transform

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 9000, clientY: 9000, bubbles: true }))
    await new Promise(r => setTimeout(r, 40))

    expect(pulledValue, "靠近时没有位移，这把尺看不见 Magnet 失效").not.toMatch(/translate3d\(0px, 0px, 0/)
    expect(layer.style.transform).not.toBe(pulledValue)
  })
})
