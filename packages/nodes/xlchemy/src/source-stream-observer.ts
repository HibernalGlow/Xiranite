export interface SourceStreamObserverOptions {
  label: string
  sourceCount: number
  activeWorkers: () => number
  onLog: (message: string) => void
  now?: () => number
}

const LOG_ROW_INTERVAL = 10_000
const LOG_MIN_ROWS = 100
const LOG_INTERVAL_MS = 5_000

export async function* observeAcceptedSourceStream(
  sources: AsyncIterable<string>,
  accepts: (path: string) => boolean,
  options: SourceStreamObserverOptions,
): AsyncGenerator<string> {
  const now = options.now ?? Date.now
  const started = now()
  let read = 0
  let accepted = 0
  let filtered = 0
  let lastLoggedAt = started
  let lastLoggedRead = 0
  options.onLog(`${options.label} opened: ${options.sourceCount} root(s); single-pass scan started.`)
  for await (const source of sources) {
    read += 1
    if (accepts(source)) {
      accepted += 1
      if (accepted === 1) options.onLog(`${options.label} first accepted input after ${formatElapsed(started, now())}.`)
      yield source
    } else {
      filtered += 1
    }
    const timestamp = now()
    const rowsSinceLog = read - lastLoggedRead
    if (rowsSinceLog >= LOG_ROW_INTERVAL || rowsSinceLog >= LOG_MIN_ROWS && timestamp - lastLoggedAt >= LOG_INTERVAL_MS) {
      options.onLog(`${options.label}: discovered ${read}, accepted ${accepted}, filtered ${filtered}; active workers ${options.activeWorkers()}.`)
      lastLoggedAt = timestamp
      lastLoggedRead = read
    }
  }
  options.onLog(`${options.label} completed: discovered ${read}, accepted ${accepted}, filtered ${filtered} in ${formatElapsed(started, now())}; single pass.`)
}

function formatElapsed(started: number, finished: number): string {
  return `${((finished - started) / 1_000).toFixed(2)}s`
}
