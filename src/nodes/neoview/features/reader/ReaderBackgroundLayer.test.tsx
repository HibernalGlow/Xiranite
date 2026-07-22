import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { ReaderBackgroundConfigDto } from "../../adapters/reader-http-client"
import { ReaderBackgroundLayer } from "./ReaderBackgroundLayer"

afterEach(cleanup)

const config: ReaderBackgroundConfigDto = {
  color: "#000000",
  mode: "ambient",
  ambient: { style: "dynamic", speed: 8, blur: 80, opacity: 0.8 },
  aurora: { showRadialGradient: true },
  spotlight: { color: "#22c55e" },
}

describe("ReaderBackgroundLayer", () => {
  it("[neoview.ambient-background.runtime-layer] renders compositor-only mode layers without page controls", () => {
    const view = render(<ReaderBackgroundLayer config={config} imageSrc="http://127.0.0.1/page/1" />)
    const root = view.container.querySelector<HTMLElement>("[data-reader-background-mode='ambient']")
    expect(root?.style.getPropertyValue("--reader-background-image")).toContain("/page/1")
    expect(root?.querySelectorAll(".reader-background-ambient span")).toHaveLength(6)
    expect(root?.querySelector("button, input, [role='slider']")).toBeNull()

    view.rerender(<ReaderBackgroundLayer config={{ ...config, mode: "aurora" }} />)
    expect(view.container.querySelector(".reader-background-aurora.is-masked")).toBeTruthy()
    expect(view.container.querySelector(".reader-background-ambient")).toBeNull()
  })

  it("[neoview.ambient-background.edge-layer] keeps edge mode distinct from auto blur cover", () => {
    const view = render(<ReaderBackgroundLayer config={{ ...config, mode: "edge" }} imageSrc="http://127.0.0.1/page/2" />)
    const root = view.container.querySelector<HTMLElement>("[data-reader-background-mode='edge']")
    expect(root).toBeTruthy()
    expect(view.container.querySelector(".reader-background-image")).toBeNull()
    // Async sample has not finished without a decodable image.
    expect(view.container.querySelector(".reader-background-edge")).toBeNull()
    expect(root?.getAttribute("data-reader-edge-ready")).toBe("false")
  })
})
