import { createContext, useContext } from "react"

const ReaderCardChromeContext = createContext(false)

export const ReaderCardChromeProvider = ReaderCardChromeContext.Provider

export function useReaderCardChrome(): boolean {
  return useContext(ReaderCardChromeContext)
}
