import type {
  ReaderFileTreeChange,
  ReaderFileTreeSubscription,
  ReaderFileTreeWatcher,
} from "../../ports/ReaderFileTreeWatcher.js"

type ParcelWatcherModule = Pick<typeof import("@parcel/watcher"), "subscribe">
type LoadParcelWatcher = () => Promise<ParcelWatcherModule>

export class PlatformFileTreeWatcher implements ReaderFileTreeWatcher {
  constructor(private readonly loadWatcher: LoadParcelWatcher = () => import("@parcel/watcher")) {}

  async subscribe(
    rootPath: string,
    onChanges: (changes: readonly ReaderFileTreeChange[]) => void,
    onError?: (error: Error) => void,
  ): Promise<ReaderFileTreeSubscription> {
    const watcher = await this.loadWatcher()
    const subscription = await watcher.subscribe(rootPath, (error, events) => {
      if (error) {
        onError?.(error)
        return
      }
      if (events.length) onChanges(events.map((event) => ({ path: event.path, kind: event.type })))
    })
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await subscription.unsubscribe()
    }
    return {
      close,
      [Symbol.asyncDispose]: close,
    }
  }
}
