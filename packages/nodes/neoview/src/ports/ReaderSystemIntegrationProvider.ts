export interface ReaderSystemIntegrationProvider {
  open(path: string, signal?: AbortSignal): Promise<void>
  reveal(path: string, signal?: AbortSignal): Promise<void>
}
