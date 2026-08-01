import type { HeadlessNodePackage } from "@xiranite/contract"
import * as core from "./core.js"
import { def } from "./definition.js"

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core, def }
export default entry

export * from "./generated/contracts.js"
export * from "./mcp-client.js"
export * from "./worker-manager.js"
