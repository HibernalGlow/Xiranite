import { describe, expect, it } from "vitest"
import {
  calculateReaderFrameSize,
  calculateReaderPageStretchScales,
  calculateReaderScale,
  effectiveReaderRotation,
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
    expect(calculateReaderFrameSize(pages, 0, "vertical")).toEqual({ width: 1_200, height: 4_000 })
    expect(rotatePresentationSize(pages[0]!, 270)).toEqual({ width: 2_000, height: 1_000 })
  })

  it("[neoview.viewer.auto-rotation] derives portrait, landscape and forced CSS rotations", () => {
    const portrait = { width: 1_000, height: 2_000 }
    const landscape = { width: 2_000, height: 1_000 }
    expect(effectiveReaderRotation(0, "left", portrait)).toBe(270)
    expect(effectiveReaderRotation(0, "left", landscape)).toBe(0)
    expect(effectiveReaderRotation(90, "horizontal-right", landscape)).toBe(180)
    expect(effectiveReaderRotation(180, "forced-left", portrait)).toBe(90)
  })

  it("[neoview.viewer.wide-stretch] preserves the legacy uniform height and average width algorithms", () => {
    const pages = [{ width: 1_000, height: 2_000 }, { width: 1_500, height: 3_000 }]
    expect(calculateReaderPageStretchScales(pages, "none")).toEqual([1, 1])
    expect(calculateReaderPageStretchScales(pages, "uniform-height")).toEqual([1.5, 1])
    expect(calculateReaderPageStretchScales(pages, "uniform-width")).toEqual([1.25, 5 / 6])
    expect(calculateReaderFrameSize(pages, 0, "horizontal", "none", "uniform-height")).toEqual({ width: 3_000, height: 3_000 })
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
