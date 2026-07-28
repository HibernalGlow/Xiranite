import { createContext, useContext, type ReactNode } from "react"

import type { ReaderStartupRestorePreference } from "./useReaderStartupRestore"

const ReaderStartupRestorePreferenceContext = createContext<ReaderStartupRestorePreference | undefined>(undefined)

export function ReaderStartupRestorePreferenceProvider({
  children,
  preference,
}: {
  children: ReactNode
  preference: ReaderStartupRestorePreference
}) {
  return (
    <ReaderStartupRestorePreferenceContext.Provider value={preference}>
      {children}
    </ReaderStartupRestorePreferenceContext.Provider>
  )
}

export function useReaderStartupRestorePreference(): ReaderStartupRestorePreference | undefined {
  return useContext(ReaderStartupRestorePreferenceContext)
}
