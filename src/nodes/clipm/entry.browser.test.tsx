import { expect, test } from "vitest"
import entry from "./entry"

test("loads the ClipM app entry in the browser bundle", () => {
  expect(entry.def).toMatchObject({ id: "clipm", name: "ClipM" })
  // `core` is optional on AppNodeEntry because a remote plugin has none; this node bundles one, so
  // the optional chain must still resolve to the function or the assertion fails.
  expect(entry.core?.runClipm).toBeTypeOf("function")
  expect(entry.Component).toBeTypeOf("function")
})
