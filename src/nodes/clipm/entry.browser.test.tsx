import { expect, test } from "vitest"
import entry from "./entry"

test("loads the ClipM app entry in the browser bundle", () => {
  expect(entry.def).toMatchObject({ id: "clipm", name: "ClipM" })
  expect(entry.core.runClipm).toBeTypeOf("function")
  expect(entry.Component).toBeTypeOf("function")
})
