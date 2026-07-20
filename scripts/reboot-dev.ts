const [target, ...args] = process.argv.slice(2)

if (!target || target === "--help" || target === "-h") {
  console.log("Usage: bun scripts/reboot-dev.ts <dev-script> [dev-script-args]")
  process.exit(target ? 0 : 2)
}

const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], {
  stdout: "inherit",
  stderr: "inherit",
})
const stopExitCode = await stop.exited
if (stopExitCode !== 0) process.exit(stopExitCode ?? 1)

console.log(`[xiranite-dev] starting ${target}.`)
const start = Bun.spawn([process.execPath, "run", target, ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => start.kill())
}

process.exit(await start.exited ?? 1)
