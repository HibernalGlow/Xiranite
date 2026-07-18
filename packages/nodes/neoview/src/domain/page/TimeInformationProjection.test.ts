import { describe, expect, it } from "vitest"

import { formatReaderTimestamp, projectReaderTimeInformation } from "./TimeInformationProjection.js"

describe("TimeInformationProjection", () => {
  it("[neoview.time-information.projection] preserves all timestamp fields and localized sources", () => {
    const value = projectReaderTimeInformation({
      source: "archive-entry",
      createdAtMs: 1_700_000_000_000,
      modifiedAtMs: 1_700_000_100_000,
      accessedAtMs: 1_700_000_200_000,
    }, "en")
    expect(value.sourceLabel).toBe("Archive entry")
    expect(value.createdText).not.toBe("—")
    expect(value.modifiedText).not.toBe("—")
    expect(value.accessedText).not.toBe("—")
  })

  it("[neoview.time-information.projection-invalid] degrades invalid and absent values without Invalid Date", () => {
    expect(formatReaderTimestamp(Number.NaN, "zh")).toBe("—")
    expect(projectReaderTimeInformation(undefined, "zh")).toEqual({ createdText: "—", modifiedText: "—", accessedText: "—", sourceLabel: "未知" })
  })
})
