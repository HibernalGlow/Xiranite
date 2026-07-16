export type ReaderPathStatus = "present" | "missing" | "unknown"

export interface ReaderPathStatusProvider {
  check(path: string, signal?: AbortSignal): Promise<ReaderPathStatus>
}
