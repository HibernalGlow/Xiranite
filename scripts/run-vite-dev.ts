import { viteDevelopmentEnvironment, type ViteDevelopmentMode } from "./vite-dev-environment"

const args = process.argv.slice(2)
const leanIndex = args.indexOf("--lean")
const mode: ViteDevelopmentMode = leanIndex === -1 ? "default" : "lean"
if (leanIndex !== -1) args.splice(leanIndex, 1)

const vite = Bun.spawn([process.execPath, "x", "vite", ...args], {
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
  env: viteDevelopmentEnvironment(mode),
})

process.exit(await vite.exited)
