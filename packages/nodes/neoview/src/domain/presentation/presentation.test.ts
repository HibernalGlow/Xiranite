import { describe, expect, it } from "vitest"
import {
  calculateReaderFrameSize,
  calculateReaderScale,
  normalizeReaderManualScale,
  normalizeReaderRotation,
  rotatePresentationSize,
  rotateReaderPresentation,
  stepReaderManualScale,
} from "./presentation.js"

describe("reader presentation geometry", () => {
  it("[neoview.viewer.fit] calculates absolute fit modes before applying manual scale", () => {
    const content = { width: 2_000, height: 3_000 }
    const viewport = { width: 1_000, height: 1_000 }
    expect(calculateReaderScale("fit", content, viewport)).toBeCloseTo(1 / 3)
    expect(calculateReaderScale("fill", content, viewport)).toBeCloseTo(1 / 2)
    expect(calculateReaderScale("fit-width", content, viewport)).toBeCloseTo(1 / 2)
    expect(calculateReaderScale("fit-height", content, viewport)).toBeCloseTo(1 / 3)
    expect(calculateReaderScale("original", content, viewport)).toBe(1)
    expect(calculateReaderScale("fit", content, viewport, 1.5)).toBeCloseTo(1 / 2)
  })

  it("[neoview.viewer.frame-size] measures a rotated double-page frame as one layout", () => {
    const pages = [{ width: 1_000, height: 2_000 }, { width: 1_200, height: 2_000 }]
    expect(calculateReaderFrameSize(pages, 0)).toEqual({ width: 2_200, height: 2_000 })
    expect(calculateReaderFrameSize(pages, 90)).toEqual({ width: 4_000, height: 1_200 })
    expect(rotatePresentationSize(pages[0]!, 270)).toEqual({ width: 2_000, height: 1_000 })
  })

  it("[neoview.viewer.presentation-bounds] normalizes rotation and bounded manual zoom", () => {
    expect(normalizeReaderRotation(-90)).toBe(270)
    expect(rotateReaderPresentation(270, 1)).toBe(0)
    expect(normalizeReaderManualScale(99)).toBe(8)
    expect(normalizeReaderManualScale(Number.NaN)).toBe(1)
    expect(stepReaderManualScale(1, 1)).toBe(1.1)
    expect(stepReaderManualScale(0.1, -1)).toBe(0.1)
  })
})
