import { expect, it } from "vitest"

import { buildWindowsShellCommand, createNodeWindowsRegistryAdapter } from "./browser.js"

it("keeps registry planning browser-safe while rejecting native adapter creation", () => {
  expect(buildWindowsShellCommand("C:\\Xiranite.exe", ["--", "%1"])).toBe('C:\\Xiranite.exe -- "%1"')
  expect(() => createNodeWindowsRegistryAdapter()).toThrow("Node host adapter")
})
