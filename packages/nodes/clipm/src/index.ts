import type { HeadlessNodePackage } from "@xiranite/contract"
import * as core from "./core.js"
import { def } from "./definition.js"

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core, def }
export default entry

export * from "./core.js"
export * from "./generated/contracts.js"
export * from "./help.js"
export * from "./mcp-client.js"
export * from "./platform.js"
export * from "./uv-bootstrap.js"
export * from "./worker-manager.js"
