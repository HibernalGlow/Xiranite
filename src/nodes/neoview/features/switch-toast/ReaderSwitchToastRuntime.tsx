import {
  renderReaderSwitchToastTemplate,
  type ReaderSwitchToastContext,
} from "@xiranite/node-neoview/ui-core"
import { useEffect, useRef } from "react"

import type { ReaderSessionDto } from "../../adapters/reader-http-client"
import type { ReaderSwitchToastPort } from "./ReaderSwitchToastStore"
import { ReaderSwitchToastHost } from "./ReaderSwitchToastHost"

export function ReaderSwitchToastRuntime({ port, session, sourcePath }: {
  port: ReaderSwitchToastPort
  session?: ReaderSessionDto
  sourcePath: string
}) {
  const previousRef = useRef<{ bookId?: string; pageIndex?: number }>({})

  useEffect(() => {
    const previous = previousRef.current
    if (!session) {
      previousRef.current = {}
      return
    }
    const settings = port.getSnapshot()
    const context = switchToastContext(session, sourcePath)
    if (previous.bookId !== session.book.id) {
      previousRef.current = { bookId: session.book.id, pageIndex: session.frame.anchorPageIndex }
      if (settings.enableBook) {
        publishTemplate(
          port,
          settings.bookTitleTemplate,
          settings.bookDescriptionTemplate,
          context,
          context.book?.displayName ?? session.book.displayName,
        )
      }
      return
    }
    if (previous.pageIndex !== session.frame.anchorPageIndex) {
      previousRef.current = { bookId: session.book.id, pageIndex: session.frame.anchorPageIndex }
      if (settings.enablePage) {
        publishTemplate(
          port,
          settings.pageTitleTemplate,
          settings.pageDescriptionTemplate,
          context,
          `第 ${session.frame.anchorPageIndex + 1} 页`,
        )
      }
    }
  }, [port, session, sourcePath])

  return <ReaderSwitchToastHost port={port} />
}

function publishTemplate(
  port: ReaderSwitchToastPort,
  titleTemplate: string,
  descriptionTemplate: string,
  context: ReaderSwitchToastContext,
  fallbackTitle: string,
): void {
  const title = renderReaderSwitchToastTemplate(titleTemplate, context).trim()
  const description = renderReaderSwitchToastTemplate(descriptionTemplate, context).trim()
  if (!title && !description) return
  port.show({ title: title || fallbackTitle, ...(description ? { description } : {}) })
}

function switchToastContext(session: ReaderSessionDto, sourcePath: string): ReaderSwitchToastContext {
  const totalPages = session.book.pageCount
  const pageIndex = session.frame.anchorPageIndex
  const page = session.visiblePages.find((candidate) => candidate.index === pageIndex) ?? session.visiblePages[0]
  const currentPageDisplay = totalPages > 0 ? Math.min(pageIndex + 1, totalPages) : 0
  return {
    book: {
      name: session.book.displayName,
      displayName: session.book.displayName,
      path: sourcePath,
      type: sourceType(sourcePath),
      totalPages,
      currentPageIndex: pageIndex,
      currentPageDisplay,
      progressPercent: totalPages > 0 ? Number(((currentPageDisplay / totalPages) * 100).toFixed(1)) : null,
    },
    page: page ? {
      name: page.name,
      displayName: page.name || `第 ${pageIndex + 1} 页`,
      path: page.assetUrl,
      index: page.index,
      indexDisplay: page.index + 1,
      width: page.dimensions?.width,
      height: page.dimensions?.height,
      dimensionsFormatted: page.dimensions ? `${page.dimensions.width} × ${page.dimensions.height}` : undefined,
      size: page.byteLength,
      sizeFormatted: formatBytesShort(page.byteLength),
    } : null,
  }
}

function sourceType(path: string): string {
  const file = path.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const dot = file.lastIndexOf(".")
  return dot > 0 ? file.slice(dot + 1).toLocaleUpperCase() : "目录"
}

function formatBytesShort(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  if (value < 1_024) return `${value} B`
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KiB`
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MiB`
  return `${(value / 1_024 ** 3).toFixed(1)} GiB`
}
