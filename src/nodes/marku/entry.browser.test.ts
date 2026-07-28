import { expect, test } from "vitest"

test("loads the Marku entry with its Markdown parser dependency graph", async () => {
  const module = await import("./entry")

  expect(module.default.def.id).toBe("marku")
  expect(module.default.Component).toBeTypeOf("function")
})
