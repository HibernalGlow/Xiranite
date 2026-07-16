import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { ReaderApp } from "../../../src/nodes/neoview/app/ReaderApp"

declare global {
  interface Window { __NEOVIEW_COPIED_TEXT__?: string }
}

const path = new URLSearchParams(location.search).get("path") ?? ""
createRoot(document.getElementById("root")!).render(
  <main style={{ width: "100vw", height: "100vh" }}>
    <ReaderApp initialPath={path} copyText={async (text) => { window.__NEOVIEW_COPIED_TEXT__ = text }} />
  </main>,
)
