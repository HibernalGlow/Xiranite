import { describe, expect, it } from "vitest"
import { advanceReaderMouseGesture, beginReaderMouseGesture } from "./ReaderMouseGesture"

describe("ReaderMouseGesture", () => {
  it("[neoview.bindings.mouse-gesture] quantizes a bounded direction sequence without adjacent duplicates", () => {
    let trace = beginReaderMouseGesture(0, 0)
    trace = advanceReaderMouseGesture(trace, 25, 0)
    trace = advanceReaderMouseGesture(trace, 50, 0)
    trace = advanceReaderMouseGesture(trace, 50, 25)
    trace = advanceReaderMouseGesture(trace, 25, 25)
    expect(trace.directions).toEqual(["right", "down", "left"])

    for (let index = 0; index < 40; index += 1) {
      trace = advanceReaderMouseGesture(trace, trace.anchorX + (index % 2 ? -25 : 25), trace.anchorY)
    }
    expect(trace.directions.length).toBeLessThanOrEqual(16)
  })
})
