import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { ContextMenuProvider } from "../../../src/components/context-menu"
import { ReaderApp } from "../../../src/nodes/neoview/app/ReaderApp"

declare global {
  interface Window {
    __NEOVIEW_COPIED_TEXT__?: string
    __NEOVIEW_COPIED_FILES__?: string[]
  }
}

const path = new URLSearchParams(location.search).get("path") ?? ""
createRoot(document.getElementById("root")!).render(
  <main style={{ width: "100vw", height: "100vh" }}>
    <ContextMenuProvider>
      <ReaderApp
        initialPath={path}
        copyText={async (text) => { window.__NEOVIEW_COPIED_TEXT__ = text }}
        copyFiles={async (paths) => { window.__NEOVIEW_COPIED_FILES__ = paths }}
      />
    </ContextMenuProvider>
  </main>,
)
