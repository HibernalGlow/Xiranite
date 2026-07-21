import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../../..")

describe("NeoView legacy characterization", () => {
  it("[neoview.emm-raw-data.legacy-characterization] preserves a nonblank 1920x1080 source Card baseline", async () => {
    const compatibility = JSON.parse(await readFile(
      resolve(root, "migration/neoview/emm-raw-data-compatibility.json"),
      "utf8",
    )) as { visualBaseline: string }
    expect(compatibility.visualBaseline).toBe("artifacts/legacy-source/neoview-emm-raw-data-1920x1080.png")

    const image = sharp(resolve(root, compatibility.visualBaseline))
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()])
    expect(metadata).toMatchObject({ format: "png", width: 1920, height: 1080 })
    expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(1)
  })
})
