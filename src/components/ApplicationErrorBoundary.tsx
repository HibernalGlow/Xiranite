import { Component, Fragment } from "react"
import type { ErrorInfo, ReactNode } from "react"
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react"
import { createLogger } from "@/lib/logger"

const logger = createLogger("app.render-boundary")

interface ApplicationErrorBoundaryProps {
  children: ReactNode
}

interface ApplicationErrorBoundaryState {
  error: Error | null
  recoveryKey: number
}

export class ApplicationErrorBoundary extends Component<ApplicationErrorBoundaryProps, ApplicationErrorBoundaryState> {
  state: ApplicationErrorBoundaryState = { error: null, recoveryKey: 0 }

  static getDerivedStateFromError(error: unknown): Partial<ApplicationErrorBoundaryState> {
    return { error: normalizeRenderError(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    logger.error(
      "Application subtree threw during render",
      { componentStack: info.componentStack ?? "" },
      normalizeRenderError(error),
    )
  }

  private handleRetry = (): void => {
    this.setState((state) => ({ error: null, recoveryKey: state.recoveryKey + 1 }))
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { children } = this.props
    const { error, recoveryKey } = this.state

    if (error) {
      return (
        <main
          className="grid min-h-screen place-items-center bg-background p-4 text-foreground"
          data-testid="application-error-fallback"
          role="alert"
        >
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive">
                <AlertTriangle aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h1 className="text-lg font-semibold">Xiranite ran into a problem</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  An unexpected rendering error stopped the application. Retry the interface, or reload Xiranite if the problem continues.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-border bg-muted/50 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Error details</p>
              <p className="break-words font-mono text-xs leading-5">{error.message}</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                onClick={this.handleRetry}
                type="button"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                Retry
              </button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                onClick={this.handleReload}
                type="button"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                Reload Xiranite
              </button>
            </div>
          </section>
        </main>
      )
    }

    return <Fragment key={recoveryKey}>{children}</Fragment>
  }
}

function normalizeRenderError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === "string" ? error : "Unknown application render error")
}
