import type * as Contract from "./reader-http-contract"

type ReaderHttpRequest = <T>(path: string, init?: RequestInit) => Promise<T>

export function createReaderExplorerContextMenuClient(request: ReaderHttpRequest) {
  return {
    explorerContextMenuPreview: (signal?: AbortSignal) =>
      request<Contract.ReaderExplorerContextMenuPreviewDto>("/reader/system/explorer-context-menu/preview", { signal }),
    explorerContextMenuStatus: (signal?: AbortSignal) =>
      request<Contract.ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu/status", { signal }),
    setExplorerContextMenuEnabled: (enabled: boolean, confirmed = false, signal?: AbortSignal) =>
      request<Contract.ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, ...(confirmed ? { confirmed: true } : {}) }),
        signal,
      }),
    repairExplorerContextMenu: (confirmed = false, signal?: AbortSignal) =>
      request<Contract.ReaderExplorerContextMenuStatusDto>("/reader/system/explorer-context-menu/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(confirmed ? { confirmed: true } : {}),
        signal,
      }),
  } satisfies Pick<
    Contract.ReaderHttpClient,
    "explorerContextMenuPreview" | "explorerContextMenuStatus" | "setExplorerContextMenuEnabled" | "repairExplorerContextMenu"
  >
}
