import { describe, expect, test } from "vitest"
import { createClassfInteractionSchema } from "./interaction.js"

describe("ClassF interaction schema", () => {
  test("maps the independent queue and SameA grouping switches to core input", () => {
    const schema = createClassfInteractionSchema({
      pathsText: "D:/set",
      alreadyEnabled: false,
      waitEnabled: true,
      delEnabled: true,
      sameaGroupAlreadyEnabled: false,
      sameaGroupWaitEnabled: true,
      sameaGroupDelEnabled: true,
    })

    expect(schema.toInput(schema.initialValues)).toMatchObject({
      paths: ["D:/set"],
      alreadyEnabled: false,
      waitEnabled: true,
      delEnabled: true,
      sameaGroupAlreadyEnabled: false,
      sameaGroupWaitEnabled: true,
      sameaGroupDelEnabled: true,
    })
  })
})
