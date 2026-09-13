import { describe, expect, test } from "vitest"
import { createClipmInteractionSchema } from "./interaction.js"

describe("ClipM interaction schema", () => {
  test("covers the native action surface and maps score options", () => {
    const schema = createClipmInteractionSchema({ path: "D:/Comics", scope: "work", rescore: true, rename: false, writeMetadata: false, dryRun: true }, "en")
    const values = { ...schema.initialValues, action: "score" as const }
    const input = schema.toInput(values)

    expect(schema.fields.find((field) => field.id === "action")?.options?.length).toBeGreaterThanOrEqual(20)
    expect(input).toMatchObject({ action: "score", path: "D:/Comics", scope: "work", scoreOptions: { rescore: true, rename: false, writeMetadata: false, dryRun: true } })
    expect(schema.isDangerous(input)).toBe(false)
  })

  test("requires an explicit feedback field and confirms mutating actions", () => {
    const schema = createClipmInteractionSchema({}, "en")
    const values = { ...schema.initialValues, action: "feedback-apply" as const, workId: "work-1", classification: "P" as const }
    const input = schema.toInput(values)

    expect(schema.validate?.(values, input)).toBeNull()
    expect(schema.isDangerous(input)).toBe(true)
    expect(schema.toInput({ ...values, classification: "unset", rankingEnabled: false }).classification).toBeUndefined()
    expect(schema.validate?.({ ...values, classification: "unset", rankingEnabled: false }, schema.toInput({ ...values, classification: "unset", rankingEnabled: false }))).toContain("classification")
  })

  test("renders score results as a compact table", () => {
    const schema = createClipmInteractionSchema({}, "en")
    const summary = schema.result({
      success: true,
      message: "Scored 1 work.",
      data: {
        action: "score",
        result: {
          path: "D:/Comics",
          discoveredWorkCount: 1,
          succeededWorkCount: 1,
          failedWorkCount: 0,
          feedback: { path: "D:/Comics", scannedWorkCount: 1, synchronizedWorkCount: 0, importedFeedbackCount: 0 },
          works: [{ workId: "work-1", path: "D:/Comics/a.cbz", label: "P", score: 900, bundleVersion: 1, shortCode: "AAAA" }],
        },
      },
    })

    expect(summary.success).toBe(true)
    expect(summary.table?.rows).toEqual([{ label: "P", score: "900", path: "D:/Comics/a.cbz" }])
  })
})
