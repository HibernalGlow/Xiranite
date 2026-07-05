/**
 * backend/client.ts — 前端调用入口。
 *
 * 这是前后端的边界：
 * - 自动选择 runtime（Electbun 优先，回退到 web mock）
 * - 创建 Backend 实例（聚合所有 service）
 * - 暴露 `getBackend()` 给前端 hooks 使用
 *
 * 切换后端框架时：
 * 1. 在 adapters/ 下新增一个文件（如 tauri.ts）
 * 2. 在 RUNTIME_FACTORIES 中注册它
 * 3. Service 层完全不动
 */

import type { RuntimeInterface, RuntimeAdapterRegistration } from "./runtime/runtime"
import { createWebRuntime } from "./adapters/web"
import { createElectbunRuntime, detectElectbun } from "./adapters/electbun"
import { createBackend, type Backend } from "./services"

// ── Runtime 注册表（按优先级排序）────────────────────────────────────────────
// 第一个 detect() 返回 true 的就是当前 runtime。
// 切换框架时：在数组里加一行即可。
const RUNTIME_FACTORIES: RuntimeAdapterRegistration[] = [
  { kind: "electbun", detect: detectElectbun, factory: createElectbunRuntime },
  { kind: "web",      detect: () => true,       factory: createWebRuntime },
]

let _runtimePromise: Promise<RuntimeInterface> | null = null
let _backendPromise: Promise<Backend> | null = null

function selectRuntime(): Promise<RuntimeInterface> {
  if (_runtimePromise) return _runtimePromise
  _runtimePromise = (async () => {
    for (const reg of RUNTIME_FACTORIES) {
      try {
        if (reg.detect()) {
          const runtime = await reg.factory()
          // eslint-disable-next-line no-console
          console.info(`[backend] runtime = ${runtime.kind}`)
          return runtime
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[backend] runtime ${reg.kind} detect/init failed:`, e)
      }
    }
    // 不应到达 — web 永远 detect 返回 true
    throw new Error("No runtime available")
  })()
  return _runtimePromise
}

export function getBackend(): Promise<Backend> {
  if (_backendPromise) return _backendPromise
  _backendPromise = selectRuntime().then(rt => createBackend({ runtime: rt }))
  return _backendPromise
}

// 便于组件直接拿 runtime（少用，多走 service）
export async function getRuntime(): Promise<RuntimeInterface> {
  return selectRuntime()
}

export type { Backend } from "./services"
