import { describe, expect, test } from "vitest"
import { createCleanfInteractionSchema } from "./interaction.js"

describe("Cleanf interaction schema", () => {
  test("allows undo without cleanup paths and describes live cleanup as recoverable", () => {
    const schema = createCleanfInteractionSchema({}, "zh")
    const undoValues = { ...schema.initialValues, action: "undo", pathsText: "" }
    const undoInput = schema.toInput(undoValues)

    expect(undoInput).toMatchObject({ action: "undo", paths: [] })
    expect(schema.validate(undoValues, undoInput)).toBeNull()
    expect(schema.isDangerous(undoInput)).toBe(false)
    expect(schema.preview(undoInput)).toContain("撤销：恢复上一次 Cleanf 清理。")

    const liveInput = schema.toInput({ ...schema.initialValues, preview: false, pathsText: "D:/cleanup" })
    expect(schema.preview(liveInput).at(-1)).toContain("系统回收站")
    expect(schema.dangerPrompt(liveInput).body).toContain("可撤销恢复")
  })
})
