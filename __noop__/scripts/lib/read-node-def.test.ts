import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { readNodeDef } from "./read-node-def"

let directory: string | undefined

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe("readNodeDef", () => {
  it("follows a local named def import without executing the node package", async () => {
    directory = await mkdtemp(join(tmpdir(), "xiranite-node-def-"))
    await writeFile(join(directory, "index.ts"), 'import { def } from "./definition.js"\nexport { def }\n')
    await writeFile(join(directory, "definition.ts"), `
      export const def = {
        id: "demo",
        name: "Demo",
        version: "1.0.0",
        category: "test",
        description: "Imported definition",
        icon: "Box",
        keywords: ["one", "two"],
      }
    `)

    await expect(readNodeDef(join(directory, "index.ts"))).resolves.toEqual({
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      category: "test",
      description: "Imported definition",
      icon: "Box",
      keywords: ["one", "two"],
    })
  })
})
