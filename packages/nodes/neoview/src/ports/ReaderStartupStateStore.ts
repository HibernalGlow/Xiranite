export interface ReaderStartupFolderState {
  path: string
  updatedAt: number
}

export interface ReaderStartupStateStore extends AsyncDisposable {
  getLastFolder(): Promise<ReaderStartupFolderState | undefined>
  saveLastFolder(path: string): Promise<ReaderStartupFolderState>
  clearLastFolder(): Promise<void>
  close(): Promise<void>
}
