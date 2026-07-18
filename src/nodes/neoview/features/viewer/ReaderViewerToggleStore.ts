export interface ReaderViewerToggleSnapshot {
  progressBarVisible: boolean
  progressBarGlow: boolean
}

export interface ReaderViewerTogglePort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderViewerToggleSnapshot
  toggleProgressBar(): void
  toggleProgressBarGlow(): void
}

const DEFAULT_SNAPSHOT: ReaderViewerToggleSnapshot = {
  progressBarVisible: true,
  progressBarGlow: true,
}

export class ReaderViewerToggleStore implements ReaderViewerTogglePort {
  #snapshot: ReaderViewerToggleSnapshot = DEFAULT_SNAPSHOT
  readonly #listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): ReaderViewerToggleSnapshot => this.#snapshot

  toggleProgressBar(): void {
    this.#replace({ ...this.#snapshot, progressBarVisible: !this.#snapshot.progressBarVisible })
  }

  toggleProgressBarGlow(): void {
    this.#replace({ ...this.#snapshot, progressBarGlow: !this.#snapshot.progressBarGlow })
  }

  #replace(snapshot: ReaderViewerToggleSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}
