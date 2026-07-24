import { describe, expect, test } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import sharp from "sharp"

import { isAnimatedImage } from "./animation-probe.js"

const ANIMATED_WEBP = "UklGRsAAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAD/////AABBTk1GSAAAAAAAAAAAAAMAAAMAAGQAAAJWUDggMAAAANABAJ0BKgQABAACADQloAJ0ugH4AAOwAP7wxAv/ILlhdcjX/yA/5Af8gP/48gAAAEFOTUZEAAAAAAAAAAAAAwAAAwAAZAAAAFZQOCAsAAAAlAEAnQEqBAAEAAAANCWgAnS6AAOYAP75k2//kB//kB//kB//ID/iF3sgMAA="
const ANIMATED_APNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAEAAAABAAAAAAAAAAAAAEACgAAV3ID4QAAABNJREFUeJxj/MfAyAADLHAWXg4ANGsBDWoZhKIAAAAaZmNUTAAAAAEAAAAEAAAABAAAAAAAAAAAAAEACgAAzAHpNQAAABdmZEFUAAAAAnicY2Rk+McAAyxwFl4OADJxAQ1IRkV5AAAAAElFTkSuQmCC"
const ANIMATED_AVIF = "AAAAKGZ0eXBhdmlzAAAAAG1pZjFhdmlmbWlhZm1zZjFpc29tYXZpcwAAAmNtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAABkAAAAFAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAB73RyYWsAAABcdGtoZAAAAAcAAAAAAAAAAAAAAAEAAAAAAAAAFAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAABAAAAAQAAAAAAYttZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAABkAAAAFFXLAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAFCbWluZgAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAQJzdGJsAAAAgnN0c2QAAAAAAAAAAQAAAHJhdjAxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAQABABIAAAASAAAAAAAAAABBEFWSUYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAADGF2MUOBDQwAAAAAEGNjc3QAAAAAQAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAAAACgAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAC8AAAAmAAAAFHN0Y28AAAAAAAAAAQAAA5kAAAAUc3RzcwAAAAAAAAABAAAAAQAAABR2bWhkAAAAAQAAAAAAAAAAAAAA1m1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAImlsb2MAAAAAREAAAQABAAAAAANpAAEAAAAAAAAAKAAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAADnBpdG0AAAAAAAEAAABWaXBycAAAADhpcGNvAAAADGF2MUOBAAwAAAAAFGlzcGUAAAAAAAAABAAAAAQAAAAQcGl4aQAAAAADCAgIAAAAFmlwbWEAAAAAAAAAAQABA4ECAwAAADBtZGF0EgAKCBgEfaICGg0IMhoZR4eGIYeeeeaAAACQQMkcYUuL0Y9RRU6koAAAAF1tZGF0EgAKDAAAAACPm18yAhoNCDIdEACWPj4zSAAPCAAAAABIVwOj+8SpchOM3DO0gSASADIiMAPAgAAABso8PDEMAANAAABAAJBA6G35qd/8Tzxo0KjOsA=="
const ANIMATED_JXL = "/woYEEEAcgIAE1BBUADEALWfIAAAFSqjjBu8nOv58kOHxbSN6wxttW1hCWOzvTBISDiDjYsevjlLI9MZkJBKEgAAE0yFKAC4ALWfIAAAFSqjjBu8nOv58kOHxbSN6wxttW1hCWOzvTBISDhqUJpN9ARhGKdKEgA="

describe("xlchemy animation probe", () => {
  test("detects static and animated WebP through Sharp metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xlchemy-webp-probe-"))
    const staticPath = join(directory, "static.webp")
    const animatedPath = join(directory, "animated.webp")
    try {
      await writeFile(staticPath, await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).webp().toBuffer())
      await writeFile(animatedPath, Buffer.from(ANIMATED_WEBP, "base64"))

      expect(await isAnimatedImage(staticPath)).toBe(false)
      expect(await isAnimatedImage(animatedPath)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }
  })

  test("records Sharp support for the other animated image formats", async () => {
    const apng = await sharp(Buffer.from(ANIMATED_APNG, "base64"), { animated: true }).metadata()
    const jxl = await sharp(Buffer.from(ANIMATED_JXL, "base64"), { animated: true }).metadata()

    expect(apng).toMatchObject({ format: "png" })
    expect(apng.pages).toBeUndefined()
    expect(jxl).toMatchObject({ format: "jxl", pages: 2, delay: [100, 100], loop: 0 })
    await expect(sharp(Buffer.from(ANIMATED_AVIF, "base64"), { animated: true }).metadata()).rejects.toThrow("unsupported image format")
  })
})
