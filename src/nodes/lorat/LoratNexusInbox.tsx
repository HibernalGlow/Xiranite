import { useEffect, useState } from "react"
import type { NexusCaptureDTO } from "@xiranite/shared"
import { Image, Link, RefreshCw, TextCursorInput } from "lucide-react"
import { listNexusCaptures, removeNexusCapture } from "@/backend/nexusCaptureClient"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

const POLL_INTERVAL_MS = 2_000

export function LoratNexusInbox(props: {
  disabled: boolean
  hasSelection: boolean
  onApply: (capture: NexusCaptureDTO) => Promise<void>
}) {
  const [captures, setCaptures] = useState<NexusCaptureDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function refresh() {
    try {
      setCaptures(await listNexusCaptures("lorat"))
      setError("")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  async function apply(capture: NexusCaptureDTO) {
    setLoading(true)
    try {
      await props.onApply(capture)
      await removeNexusCapture(capture.id)
      setCaptures((current) => current.filter((item) => item.id !== capture.id))
      setError("")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }

  if (!captures.length && !error) return null

  return (
    <section className="border-y bg-muted/20 px-3 py-2" data-testid="lorat-nexus-inbox">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">Nexus inbox</h3>
          <p className="truncate text-xs text-muted-foreground">{captures.length} browser capture{captures.length === 1 ? "" : "s"}</p>
        </div>
        <Button aria-label="Refresh Nexus inbox" disabled={loading} size="icon-xs" variant="ghost" onClick={() => void refresh()}>
          <RefreshCw />
        </Button>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <ScrollArea className="max-h-32">
        <div className="space-y-1">
          {captures.map((capture) => {
            const Icon = capture.kind === "image" ? Image : capture.kind === "selection" ? TextCursorInput : Link
            return (
              <div key={capture.id} className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-b-0">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{capture.source.title || capture.source.url}</p>
                  <p className="truncate text-xs text-muted-foreground">{capture.content?.text || capture.source.url}</p>
                </div>
                <Button disabled={props.disabled || loading || !props.hasSelection} size="xs" variant="outline" onClick={() => void apply(capture)}>Apply</Button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}
