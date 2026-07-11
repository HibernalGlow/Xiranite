import { desktopRuntimePermissionArgs, resolveDenoCommand } from "./deno-desktop-command"

const frontendUrl = Bun.env.FRONTEND_DEVSERVER_URL ?? `http://127.0.0.1:${Bun.env.XIRANITE_FRONTEND_PORT ?? "5173"}`

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(frontendUrl, { method: "HEAD" })
    if (response.ok || response.status === 404) break
  } catch {
    // The existing dev server is still starting.
  }
  if (attempt === 39) throw new Error(`Vite dev server is not reachable: ${frontendUrl}. Start it with "bun run dev" first.`)
  await Bun.sleep(150)
}

console.log(`[xiranite-frontend:attach] ${frontendUrl}`)

const desktop = Bun.spawn([
  resolveDenoCommand(),
  "desktop",
  "--hmr",
  "--backend",
  "webview",
  "--config",
  "desktop/deno/deno.json",
  ...desktopRuntimePermissionArgs(),
  "desktop/deno/main.ts",
], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...Bun.env,
    FRONTEND_DEVSERVER_URL: frontendUrl,
  },
})

process.exit(await desktop.exited ?? 0)
