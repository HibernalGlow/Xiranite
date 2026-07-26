import { useCallback, useEffect, useState } from "react"
import { useTheme } from "@/components/use-theme"

// Bridges Folia's daylight action to Xiranite's single, persisted theme controller.
export function useMelodeckThemeMode() {
  const { setTheme } = useTheme()
  const [isDaylight, setIsDaylight] = useState(() => (
    typeof document === "undefined" || !document.documentElement.classList.contains("dark")
  ))

  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDaylight(!root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] })
    return () => observer.disconnect()
  }, [])

  const setDaylight = useCallback((nextDaylight: boolean) => {
    setTheme(nextDaylight ? "light" : "dark")
  }, [setTheme])

  return { isDaylight, setDaylight }
}
