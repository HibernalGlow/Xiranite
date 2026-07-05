/**
 * Runtime Interface — 后端能力层抽象。
 *
 * 设计原则（用户原话："强约束 Runtime Interface（能力层）+ Adapter IPC（必须存在）"）：
 *
 * 1. **强约束**：每项能力是一个明确的方法签名，不是松散的 invoke(channel, args)。
 *    后端 Service 只能调用 RuntimeInterface 声明的能力，没有 escape hatch。
 *
 * 2. **能力分层**：
 *    - StorageRuntime：键值 / 文档持久化（workspace/components 配置）
 *    - FileSystemRuntime：读写真实文件（EngineV 扫描工坊目录）
 *    - SubprocessRuntime：启动子进程（调用外部 CLI 工具）
 *    - EventBusRuntime：跨进程事件推送（任务进度）
 *
 * 3. **Adapter IPC 必须存在**：每个具体 runtime（web/electbun/tauri）必须实现这套接口，
 *    通过 IPC 调到主进程或 mock 实现。Service 层永远不直接接触 IPC channel。
 *
 * 切换后端框架（Electbun → Tauri → Electron）只需要实现一个新的 adapter，
 * Service 层完全不动。
 */

import type { ProgressEvent } from "../shared/types"

// ── Storage ─────────────────────────────────────────────────────────────────
export interface StorageRuntime {
  /** 读一个键，返回字符串或 null。实现需保证 UTF-8。 */
  get(key: string): Promise<string | null>
  /** 写一个键。value 必须是字符串（上层负责序列化）。 */
  set(key: string, value: string): Promise<void>
  /** 删一个键。不存在的键视为成功。 */
  delete(key: string): Promise<void>
  /** 列出某前缀下所有键。 */
  keys(prefix: string): Promise<string[]>
}

// ── FileSystem ──────────────────────────────────────────────────────────────
export interface FsStat {
  path: string
  isDirectory: boolean
  sizeBytes: number
  lastModified: number
}

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  lastModified: number
}

export interface FileSystemRuntime {
  /** 判断路径是否存在。 */
  exists(path: string): Promise<boolean>
  /** 列出目录下的条目（不递归）。 */
  listDir(dirPath: string): Promise<FsEntry[]>
  /** 读文件，UTF-8 字符串。 */
  readFileText(path: string): Promise<string>
  /** 读文件，原始 bytes。 */
  readFileBytes(path: string): Promise<Uint8Array>
  /** 写文件（覆盖）。自动创建父目录。 */
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  /** 删除文件或目录（目录递归）。可选 moveToTrash。 */
  remove(path: string, opts?: { permanent?: boolean }): Promise<void>
  /** 重命名/移动。 */
  rename(oldPath: string, newPath: string): Promise<void>
  /** 取 stat。 */
  stat(path: string): Promise<FsStat>
}

// ── Subprocess ──────────────────────────────────────────────────────────────
export interface SubprocessSpawnOpts {
  cwd?: string
  env?: Record<string, string>
  /** 标准输入（可选）。 */
  stdin?: string
}

export interface SubprocessResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface SubprocessRuntime {
  /** 启动子进程，跑完返回。流式输出通过 onStdout/onStderr 回调。 */
  spawn(
    cmd: string,
    args: string[],
    opts: SubprocessSpawnOpts,
    handlers?: {
      onStdout?: (chunk: string) => void
      onStderr?: (chunk: string) => void
    },
  ): Promise<SubprocessResult>
  /** 杀进程（按 spawn 返回的 pid）。 */
  kill?(pid: number): Promise<void>
}

// ── EventBus ────────────────────────────────────────────────────────────────
export interface EventBusRuntime {
  /** 订阅某 topic 的事件。返回 unsubscribe 函数。 */
  subscribe(topic: string, handler: (event: ProgressEvent) => void): Promise<() => void>
  /** 发布事件到某 topic。 */
  publish(topic: string, event: ProgressEvent): Promise<void>
}

// ── 总接口 ──────────────────────────────────────────────────────────────────
export interface RuntimeInterface {
  readonly kind: "web" | "electbun" | "tauri" | "electron"
  storage: StorageRuntime
  fs: FileSystemRuntime
  subprocess: SubprocessRuntime
  events: EventBusRuntime
}

// ── Adapter 注册协议 ────────────────────────────────────────────────────────
/**
 * 每个 adapter 必须实现此工厂。runtime 选择在 src/backend/client.ts 中完成。
 * 切换框架时只需新增一个 adapter 文件并注册到 RUNTIME_FACTORIES。
 *
 * factory 既可同步返回 RuntimeInterface，也可返回 Promise。前者用于纯 JS 实现
 * （web），后者用于需要异步初始化的 IPC 桥接（electbun）。
 */
export type RuntimeAdapterFactory = () => RuntimeInterface | Promise<RuntimeInterface>

export interface RuntimeAdapterRegistration {
  kind: RuntimeInterface["kind"]
  /** detect 应当快速、无副作用，决定本环境是否能用此 adapter。 */
  detect: () => boolean
  factory: RuntimeAdapterFactory
}
