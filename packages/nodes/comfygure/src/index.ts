import type { HeadlessNodePackage } from "@xiranite/contract"
import * as core from "./core.js"
import { def } from "./definition.js"

const entry = { def, core } satisfies HeadlessNodePackage<typeof core>

export { core }
export { def } from "./definition.js"
export * from "./core.js"
export * from "./project.js"
export default entry
