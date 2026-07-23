import { useEffect } from "react"

import { initializeDesktopTrays } from "./trayCoordinator"

export function DesktopTrayBridge() {
  useEffect(() => {
    void initializeDesktopTrays().catch((error) => {
      console.warn("[desktop-tray] initialization failed:", error)
    })
  }, [])

  return null
}
