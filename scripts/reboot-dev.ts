import { stopProcessTree } from "./managed-process"

const [target, ...args] = process.argv.slice(2)

if (!target || target === "--help" || target === "-h") {
  console.log("用法：bun scripts/reboot-dev.ts <开发脚本> [启动参数]")
  process.exit(target ? 0 : 2)
}

const stop = Bun.spawn([process.execPath, "scripts/stop-dev.ts"], {
  stdout: "inherit",
  stderr: "inherit",
})
const stopExitCode = await stop.exited
if (stopExitCode !== 0) process.exit(stopExitCode ?? 1)

console.log(`[Xiranite 开发] 正在启动${target.includes("desktop") ? "桌面" : "浏览器"}开发宿主。`)
const start = Bun.spawn([process.execPath, "run", target, ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void stopProcessTree(start) })
}

process.exit(await start.exited ?? 1)
