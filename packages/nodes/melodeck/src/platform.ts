import { createConnection } from "node:net"
import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { stat } from "node:fs/promises"
import type { MelodeckRuntime } from "./core.js"

const exec = promisify(execFile)
export const DEFAULT_MELODECK_IPC = process.platform === "win32" ? "\\\\.\\pipe\\xiranite-melodeck" : "/tmp/xiranite-melodeck.sock"
export function createNodeMelodeckRuntime(): MelodeckRuntime { return { resolve, launch, command } }
async function resolve(path?: string) { if (path) { try { await stat(path); return { found: true, path } } catch { return { found: false, path: "" } } } try { const { stdout } = await exec(process.platform === "win32" ? "where.exe" : "which", ["mpv"], { windowsHide: true }); return { found: true, path: stdout.split(/\r?\n/).find(Boolean)?.trim() ?? "mpv" } } catch { return { found: false, path: "" } } }
async function launch(path: string, args: string[]) { const resolved = args.map((arg) => arg.replace("${XIRANITE_MELODECK_IPC}", DEFAULT_MELODECK_IPC)); const child = spawn(path, resolved, { detached: true, stdio: "ignore", windowsHide: true }); child.unref() }
async function command(path: string, value: Record<string, unknown>) { return new Promise<Record<string, unknown>>((resolve, reject) => { const socket = createConnection(path); let buffer = ""; const timer = setTimeout(() => { socket.destroy(); reject(new Error("mpv IPC timed out")) }, 2_000); socket.on("connect", () => socket.write(`${JSON.stringify(value)}\n`)); socket.on("data", (chunk) => { buffer += String(chunk); const line = buffer.split("\n")[0]; if (!line) return; clearTimeout(timer); socket.end(); try { resolve(JSON.parse(line) as Record<string, unknown>) } catch { resolve({ error: "invalid mpv response", raw: line }) } }); socket.on("error", (error) => { clearTimeout(timer); reject(error) }) }) }
