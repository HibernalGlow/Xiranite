import { Children, isValidElement, type ReactNode } from "react"

import type { ReaderFolderTabsConfig } from "../../../../adapters/reader-http-client"

export default function FolderChromeLayout({ layout, tabBar, breadcrumb, children }: {
  layout: ReaderFolderTabsConfig
  tabBar: ReactNode
  breadcrumb: ReactNode
  children: ReactNode
}) {
  const slots = Children.toArray(children)
  const toolbar = slots.find((child) => isValidElement<{ "data-folder-chrome-slot"?: string }>(child) && child.props["data-folder-chrome-slot"] === "toolbar")
  const content = slots.find((child) => isValidElement<{ "data-folder-chrome-slot"?: string }>(child) && child.props["data-folder-chrome-slot"] === "content")
  const breadcrumbVertical = isVertical(layout.breadcrumbPosition)
  const tabsVertical = isVertical(layout.layout)
  const toolbarVertical = isVertical(layout.toolbarPosition)
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 gap-2 ${breadcrumbVertical ? "flex-row" : "flex-col"}`} data-folder-layout-layer="breadcrumb">
      {layout.breadcrumbPosition !== "none" ? (
        <div
          className={breadcrumbVertical ? "min-h-0 w-40 shrink-0 overflow-auto" : "min-w-0 shrink-0"}
          style={{ order: isTrailing(layout.breadcrumbPosition) ? 2 : 0 }}
          data-folder-layout-region="breadcrumb"
        >
          {breadcrumb}
        </div>
      ) : null}
      <div className={`flex min-h-0 min-w-0 flex-1 gap-2 ${tabsVertical ? "flex-row" : "flex-col"}`} style={{ order: 1 }} data-folder-layout-layer="tabs">
        <div
          className="min-h-0 min-w-0 shrink-0"
          style={{ order: isTrailing(layout.layout) ? 2 : 0 }}
          data-folder-layout-region={layout.layout === "none" ? "tab-layout-control" : "tabs"}
        >
          {tabBar}
        </div>
        <div className={`flex min-h-0 min-w-0 flex-1 gap-2 ${toolbarVertical ? "flex-row" : "flex-col"}`} style={{ order: 1 }} data-folder-layout-layer="toolbar">
          {layout.toolbarPosition !== "none" ? (
            <div
              className={`grid shrink-0 gap-1 ${toolbarVertical ? "w-40 content-start overflow-y-auto" : "min-w-0"}`}
              style={{ order: isTrailing(layout.toolbarPosition) ? 2 : 0 }}
              data-folder-layout-region="toolbar"
            >
              {toolbar}
            </div>
          ) : null}
          <div className="grid min-h-0 min-w-0 flex-1 gap-2" style={{ order: 1 }} data-folder-layout-region="content">
            {content}
          </div>
        </div>
      </div>
    </div>
  )
}

function isVertical(position: ReaderFolderTabsConfig["layout"]): boolean {
  return position === "left" || position === "right"
}

function isTrailing(position: ReaderFolderTabsConfig["layout"]): boolean {
  return position === "right" || position === "bottom"
}
