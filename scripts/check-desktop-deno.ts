import { resolveDenoCommand } from "./deno-desktop-command"

const check = Bun.spawn([
  resolveDenoCommand(),
  "check",
  "--desktop",
  "--config",
  "desktop/deno/deno.json",
  "desktop/deno/main.ts",
], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await check.exited ?? 0)
