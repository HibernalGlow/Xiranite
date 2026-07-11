import { desktopRuntimePermissionArgs, resolveDenoCommand } from "./deno-desktop-command"

await run([process.execPath, "run", "build"], {
  GOMAXPROCS: Bun.env.GOMAXPROCS ?? "2",
})
await run([process.execPath, "run", "build:backend:deno"])

await run([
  resolveDenoCommand(),
  "desktop",
  "--backend",
  "webview",
  "--config",
  "desktop/deno/deno.json",
  ...desktopRuntimePermissionArgs(),
  "--exclude-unused-npm",
  "--icon",
  "build/windows/icon.ico",
  "--include",
  "dist",
  "--include",
  "build/deno/xiranite-backend.js",
  "--output",
  "build/deno/Xiranite",
  "desktop/deno/main.ts",
])

async function run(command: string[], env?: Record<string, string>): Promise<void> {
  console.log(`$ ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: env ? { ...Bun.env, ...env } : undefined,
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode ?? 1)
}
