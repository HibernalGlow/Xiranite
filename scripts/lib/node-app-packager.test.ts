import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

import { collectNodeAppSourcePaths } from "./node-app-packager"

const repositoryRoot = resolve(import.meta.dirname, "../..")

describe("node app packager", () => {
  test("includes the Shell integration package and external host entry page in NeoView snapshots", async () => {
    const paths = await collectNodeAppSourcePaths(repositoryRoot, "neoview", ["reader"])

    expect(paths).toContain("packages/shell-integration/src/index.ts")
    expect(paths).toContain("src/entrypoints/node-host.html")
  })
})
