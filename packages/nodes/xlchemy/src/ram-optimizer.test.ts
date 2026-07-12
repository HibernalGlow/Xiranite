import { describe, expect, test } from "vitest"
import { DEFAULT_RAM_OPTIMIZER_RULES, doesRamRuleApply, isRamOptimizerNecessary, jpegXlUsesHighRam, maxRamOptimizerWorkers, optimizedEncoderThreads, parseRamOptimizationRules } from "./ram-optimizer.js"

describe("Xlchemy RAM optimizer", () => {
  test("parses the original rules safely", () => {
    expect(parseRamOptimizationRules(DEFAULT_RAM_OPTIMIZER_RULES)).toHaveLength(8)
    expect(parseRamOptimizationRules('("JPEG XL", 8, "3/4"), ("unsupported", 9, "1"), ("all", -1, "1/2")')).toEqual([{ scope: "JPEG XL", threshold: 8, target: "3/4" }])
    expect(parseRamOptimizationRules('("all", 10, "1/0")')).toEqual([])
  })
  test("matches JPEG XL and SVT scopes", () => {
    expect(doesRamRuleApply({ scope: "all", threshold: 1, target: "1" }, "JPEG XL")).toBe(true)
    expect(doesRamRuleApply({ scope: "SVT-AV1-PSY", threshold: 1, target: "1" }, "AVIF", "svt")).toBe(true)
    expect(doesRamRuleApply({ scope: "SVT-AV1-PSY", threshold: 1, target: "1" }, "AVIF", "aom")).toBe(false)
  })
  test.each([[7, false, false, false, false], [8, false, false, false, true], [7, false, false, true, true], [7, true, false, false, true], [9, false, true, false, false], [10, false, true, false, true]] as const)("preserves JPEG XL high-memory detection", (effort, modular, lossless, intelligent, expected) => expect(jpegXlUsesHighRam(effort, modular, lossless, intelligent)).toBe(expected))
  test("activates only for original high-memory combinations", () => {
    const base = { jpegXlEffort: 8, jpegXlLossyModular: false, jpegXlLossless: false, jpegXlIntelligentEffort: false }
    expect(isRamOptimizerNecessary({ ...base, format: "JPEG XL" })).toBe(true)
    expect(isRamOptimizerNecessary({ ...base, format: "AVIF", avifEncoder: "svt" })).toBe(true)
    expect(isRamOptimizerNecessary({ ...base, format: "AVIF", avifEncoder: "aom" })).toBe(false)
  })
  test("uses the highest matching threshold and floors fractions", () => {
    const rules = parseRamOptimizationRules(DEFAULT_RAM_OPTIMIZER_RULES)
    expect(maxRamOptimizerWorkers(16, 3.5, "JPEG XL", "", rules)).toBe(14)
    expect(maxRamOptimizerWorkers(16, 8.6, "JPEG XL", "", rules)).toBe(4)
    expect(maxRamOptimizerWorkers(16, 10.5, "JPEG XL", "", rules)).toBe(1)
    expect(maxRamOptimizerWorkers(2, 9.6, "JPEG XL", "", rules)).toBe(1)
  })
  test("preserves mode semantics and recalculates dynamic encoder threads", () => {
    const context = { format: "JPEG XL", jpegXlEffort: 10, jpegXlLossyModular: false, jpegXlLossless: true, jpegXlIntelligentEffort: false }
    const rules = parseRamOptimizationRules(DEFAULT_RAM_OPTIMIZER_RULES)
    expect(optimizedEncoderThreads("disabled", 16, 8.6, context, rules)).toBe(16)
    expect(optimizedEncoderThreads("static", 16, 8.6, context, rules)).toBe(16)
    expect(optimizedEncoderThreads("dynamic", 16, 8.6, context, rules)).toBe(4)
  })
})
