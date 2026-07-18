import { describe, expect, it } from "vitest"
import { cli } from "./cli.js"
describe("VERT CLI", () => { it("registers the universal converter command", () => { expect(cli.name).toBe("xvert"); expect(cli.description).toContain("CLI-first") }) })
