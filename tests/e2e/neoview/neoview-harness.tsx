import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { ContextMenuProvider } from "../../../src/components/context-menu"
import { ReaderApp } from "../../../src/nodes/neoview/app/ReaderApp"

const path = new URLSearchParams(location.search).get("path") ?? ""

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ContextMenuProvider>
      <main style={{ width: "100vw", height: "100vh" }}>
        <ReaderApp initialPath={path} />
      </main>
    </ContextMenuProvider>
  </StrictMode>,
)
