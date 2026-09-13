#!/usr/bin/env node
/**
 * jellypot PotPlayer 协议启动器（Node/TS 实现，无需编译 exe）。
 *
 * 注册表把 potplayer:// 协议指到这里（见 assets/potplayer-protocol.reg）：
 *   node dist/launcher.js "%1"
 *
 * 浏览器在发起外部协议时会把 potplayer://F:/x 规范化为 potplayer://F/x
 * （吃掉盘符冒号），并把非 ASCII 字符百分号编码。core.normalizeMediaPath
 * 已覆盖这些情况：剥前缀、百分号解码、补回盘符、斜杠统一为反斜杠。
 * 之后以命令行参数方式启动 PotPlayerMini64.exe，路径原样传入，
 * 不经过任何 URL/协议解析，因此空格、#、CJK 等字符都安全。
 */
import { spawn } from "node:child_process"
import { existsSync, appendFileSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_POTPLAYER_PATHS, normalizeMediaPath } from "./core.js"

const LOG_PATH = join(tmpdir(), "jellypot-launcher.log")
const MAX_LOG_BYTES = 256 * 1024

function log(message: string): void {
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_LOG_BYTES) {
      appendFileSync(LOG_PATH, "", { flag: "w" })
    }
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8")
  } catch {
    // 日志失败不影响主流程
  }
}

function main(): void {
  const url = process.argv[2] ?? ""
  log(`RECEIVED: ${url}`)

  if (!url) {
    log("EMPTY URL")
    process.exit(1)
  }

  const path = normalizeMediaPath(url)
  log(`PATH: ${path}`)
  if (!path) {
    process.exit(1)
  }

  if (!existsSync(path)) {
    log(`NOT FOUND: ${path}`)
    process.exit(1)
  }

  const potplayer = DEFAULT_POTPLAYER_PATHS.find((candidate) => existsSync(candidate))
  if (!potplayer) {
    log("POTPLAYER NOT FOUND")
    process.exit(1)
  }

  log(`LAUNCH: ${potplayer} "${path}"`)
  // detached + unref：不阻塞协议处理进程，PotPlayer 独立存活；
  // windowsHide：本进程经 wscript 垫片以隐藏窗口运行，子进程同样不建控制台
  const child = spawn(potplayer, [path], { detached: true, stdio: "ignore", windowsHide: true })
  child.unref()
  process.exit(0)
}

void main()
