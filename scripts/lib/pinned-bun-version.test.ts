import { expect, test } from "bun:test"
import { parseBunVersionFromPackageManager, pinnedBunVersion } from "./pinned-bun-version.ts"

test("reads the pinned Bun release from the root packageManager field", async () => {
  const version = await pinnedBunVersion()
  expect(version).toMatch(/^\d+\.\d+\.\d+$/)
})

test("accepts only an exact bun@x.y.z pin", () => {
  expect(parseBunVersionFromPackageManager("bun@1.3.0")).toBe("1.3.0")
  expect(parseBunVersionFromPackageManager(" bun@1.3.0 ")).toBe("1.3.0")
  expect(() => parseBunVersionFromPackageManager("bun@canary")).toThrow(/expected bun@<x\.y\.z>/)
  expect(() => parseBunVersionFromPackageManager("node@22.0.0")).toThrow(/expected bun@<x\.y\.z>/)
  expect(() => parseBunVersionFromPackageManager(undefined)).toThrow(/must pin packageManager/)
})
