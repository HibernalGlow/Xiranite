import { describe, expect, it, vi } from "vitest"

import {
  createNeoviewImageTrimTuiDefinition,
  type NeoviewImageTrimTuiPort,
} from "../interaction.js"
import {
  DEFAULT_READER_IMAGE_TRIM,
  type ReaderImageTrimSettings,
} from "../application/image-trim/ReaderImageTrim.js"

describe("NeoView image-trim terminal interaction", () => {
  it("[neoview.image-trim.tui] [neoview.image-trim.reset-tui] [neoview.image-trim.tui-edges] inspects, applies and resets through one canonical port", async () => {
    const updated: ReaderImageTrimSettings = {
      ...DEFAULT_READER_IMAGE_TRIM,
      enabled: true,
      top: 20,
      bottom: 20,
      left: 15,
      right: 15,
      linkVertical: true,
      linkHorizontal: true,
      autoTrimThreshold: 45,
      autoTrimTarget: "white",
    }
    const inspect = vi.fn(async () => DEFAULT_READER_IMAGE_TRIM)
    const apply = vi.fn(async () => ({ changed: true, config: updated }))
    const reset = vi.fn(async () => ({ changed: true, config: DEFAULT_READER_IMAGE_TRIM }))
    const port = { inspect, apply, reset } as NeoviewImageTrimTuiPort
    const definition = createNeoviewImageTrimTuiDefinition("en", port)

    await expect(definition.run({ action: "inspect" }, () => undefined)).resolves.toMatchObject({ success: true, config: DEFAULT_READER_IMAGE_TRIM })
    await expect(definition.run({ action: "apply", patch: updated }, () => undefined)).resolves.toMatchObject({ success: true, config: updated })
    await expect(definition.run({ action: "reset" }, () => undefined)).resolves.toMatchObject({ success: true, config: DEFAULT_READER_IMAGE_TRIM })
    expect(apply).toHaveBeenCalledWith(updated, true)
    expect(reset).toHaveBeenCalledWith(true)
  })

  it("[neoview.image-trim.bounds-tui] [neoview.image-trim.threshold-tui] [neoview.image-trim.target-tui] [neoview.image-trim.persistence] [neoview.image-trim.persistence-tui] validates the complete form with the shared codec", () => {
    const schema = createNeoviewImageTrimTuiDefinition("en", {} as NeoviewImageTrimTuiPort).schema
    const values = {
      action: "apply",
      enabled: true,
      top: 10,
      bottom: 20,
      left: 5,
      right: 15,
      linkVertical: true,
      linkHorizontal: true,
      threshold: 45,
      target: "white",
    }
    const input = schema.toInput(values)
    expect(input).toEqual({ action: "apply", patch: {
      enabled: true,
      top: 10,
      bottom: 20,
      left: 5,
      right: 15,
      linkVertical: true,
      linkHorizontal: true,
      autoTrimThreshold: 45,
      autoTrimTarget: "white",
    } })
    expect(schema.validate(values, input)).toBeNull()
    const invalid = schema.toInput({ ...values, top: 46, threshold: 12 })
    expect(schema.validate({ ...values, top: 46, threshold: 12 }, invalid)).toMatch(/top|threshold|step/)
    expect(schema.isDangerous(input)).toBe(true)
    expect(schema.isDangerous({ action: "inspect" })).toBe(false)
    expect(schema.isDangerous({ action: "reset" })).toBe(true)
  })
})
