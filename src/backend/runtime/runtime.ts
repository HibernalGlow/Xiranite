import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { ProgressEvent } from "../shared/types"

export interface StorageRuntime {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

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
  exists(path: string): Promise<boolean>
  listDir(dirPath: string): Promise<FsEntry[]>
  readFileText(path: string): Promise<string>
  readFileBytes(path: string): Promise<Uint8Array>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  remove(path: string, opts?: { permanent?: boolean }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  stat(path: string): Promise<FsStat>
}

export interface SubprocessSpawnOpts {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
}

export interface SubprocessResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface SubprocessRuntime {
  spawn(
    cmd: string,
    args: string[],
    opts: SubprocessSpawnOpts,
    handlers?: {
      onStdout?: (chunk: string) => void
      onStderr?: (chunk: string) => void
    },
  ): Promise<SubprocessResult>
  kill?(pid: number): Promise<void>
}

export interface EventBusRuntime {
  subscribe(topic: string, handler: (event: ProgressEvent) => void): Promise<() => void>
  publish(topic: string, event: ProgressEvent): Promise<void>
}

export interface NodeRunnerRuntime {
  runNode: <TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<NodeRunResult<TData>>
}

export type MainWindowAction = "minimize" | "maximize" | "restore" | "close"

export interface WindowCapabilities {
  supported: boolean
  nativeWindowControls: boolean
  frameless: boolean
  componentWindows: "native" | "browser-fallback" | "browser-popup" | "unsupported"
  message?: string
}

export interface WindowCommandResult {
  success: boolean
  supported: boolean
  id?: string
  message: string
  state?: "normal" | "maximized" | "minimized" | "closed"
}

export interface WindowFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface OpenComponentWindowInput {
  componentId: string
  moduleId: string
  title?: string
  width?: number
  height?: number
}

export interface WindowRuntime {
  getCapabilities(): Promise<WindowCapabilities>
  controlMain(action: MainWindowAction): Promise<WindowCommandResult>
  openComponent(input: OpenComponentWindowInput): Promise<WindowCommandResult>
  focus(id: string): Promise<WindowCommandResult>
  close(id: string): Promise<WindowCommandResult>
  getFrame(id?: string): Promise<WindowFrame | null>
  setFrame(frame: WindowFrame, id?: string): Promise<WindowCommandResult>
}

export interface RuntimeInterface {
  readonly kind: "web" | "wails" | "tauri" | "electron"
  storage: StorageRuntime
  fs: FileSystemRuntime
  subprocess: SubprocessRuntime
  events: EventBusRuntime
  nodeRunner: NodeRunnerRuntime
  windows: WindowRuntime
}

export type RuntimeAdapterFactory = () => RuntimeInterface | Promise<RuntimeInterface>

export interface RuntimeAdapterRegistration {
  kind: RuntimeInterface["kind"]
  detect: () => boolean
  factory: RuntimeAdapterFactory
}
