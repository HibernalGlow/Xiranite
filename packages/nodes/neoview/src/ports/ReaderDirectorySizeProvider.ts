export interface ReaderDirectorySize {
  path: string
  bytes: number
  fileCount: number
}

export interface ReaderDirectorySizeProvider {
  measure(path: string, signal?: AbortSignal): Promise<ReaderDirectorySize>
}
