import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

import i18n from "@/i18n"
import { BACKGROUND_IMAGE_MAX_DATA_URL_BYTES, estimateBackgroundImageBytes, isBackgroundImageDataUrl } from "@/lib/backgroundImage"
import { formatBytes } from "@/lib/format"
import { createNoisePngFile, readBlobAsDataUrl } from "@/test/noiseImageFixture"
import { BackgroundImagePicker } from "./BackgroundImagePicker"

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)!.set!

function fillInput(element: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function pickFile(element: HTMLInputElement, file: File) {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  element.files = transfer.files
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("BackgroundImagePicker", () => {
  test("never renders an embedded data URL into the URL text field", async () => {
    await i18n.changeLanguage("en")
    const embedded = await readBlobAsDataUrl(await createNoisePngFile(240, 160))
    const screen = await render(<BackgroundImagePicker value={embedded} onChange={() => undefined} />)

    const urlField = screen.getByRole("textbox")
    await expect.element(urlField).toHaveValue("")
    // 反证：一旦原值回到 DOM，就是本次要修的「整张 base64 塞进输入框」。
    const element = urlField.element() as HTMLInputElement
    expect(element.value).not.toContain("base64")
    expect(element.getAttribute("placeholder")).toMatch(/embedded image/i)
    expect(element.getAttribute("placeholder")).toContain(formatBytes(estimateBackgroundImageBytes(embedded)))
  })

  test("compresses an oversized picked file before handing it to the store", async () => {
    await i18n.changeLanguage("en")
    const onChange = vi.fn()
    const screen = await render(<BackgroundImagePicker value="" onChange={onChange} />)

    const fileInput = document.querySelector<HTMLInputElement>("#bg-file-upload")
    if (!fileInput) throw new Error("background image file input is missing")
    pickFile(fileInput, await createNoisePngFile(1600, 1200))

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce())
    const next = onChange.mock.calls[0]![0] as string
    expect(isBackgroundImageDataUrl(next)).toBe(true)
    expect(estimateBackgroundImageBytes(next)).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)
    await expect.element(screen.getByTestId("bg-image-status")).toHaveTextContent(/Auto-compressed/)
  }, 60_000)

  test("compresses an oversized data URL pasted into the URL field", async () => {
    await i18n.changeLanguage("en")
    const onChange = vi.fn()
    const screen = await render(<BackgroundImagePicker value="" onChange={onChange} />)

    const oversized = await readBlobAsDataUrl(await createNoisePngFile(1200, 900))
    expect(estimateBackgroundImageBytes(oversized)).toBeGreaterThan(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)
    fillInput(screen.getByRole("textbox").element() as HTMLInputElement, oversized)

    await vi.waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as string | undefined
      expect(latest).toBeDefined()
      expect(estimateBackgroundImageBytes(latest!)).toBeLessThanOrEqual(BACKGROUND_IMAGE_MAX_DATA_URL_BYTES)
    })
    await expect.element(screen.getByTestId("bg-image-status")).toHaveTextContent(/Auto-compressed/)
  }, 60_000)
})
