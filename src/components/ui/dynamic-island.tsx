import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react"
import { motion, useWillChange } from "motion/react"
import { cn } from "@/lib/utils"

export type SizePresets = "minimalLeading" | "compact"

type Preset = {
  width: number
  aspectRatio: number
  borderRadius: number
}

const DEFAULT_PRESETS: Record<SizePresets, Preset> = {
  minimalLeading: {
    width: 52,
    aspectRatio: 44 / 52,
    borderRadius: 22,
  },
  compact: {
    width: 235,
    aspectRatio: 44 / 235,
    borderRadius: 22,
  },
}

type IslandState = {
  size: SizePresets
  previousSize: SizePresets
}

type IslandAction = {
  type: "SET_SIZE"
  size: SizePresets
}

type DynamicIslandContextValue = {
  state: IslandState
  setSize: (size: SizePresets) => void
  presets: Record<SizePresets, Preset>
}

const DynamicIslandContext = createContext<DynamicIslandContextValue | undefined>(undefined)

function islandReducer(state: IslandState, action: IslandAction): IslandState {
  if (action.size === state.size) return state
  return {
    size: action.size,
    previousSize: state.size,
  }
}

export function DynamicIslandProvider({
  children,
  initialSize = "minimalLeading",
  presets: customPresets,
}: {
  children: ReactNode
  initialSize?: SizePresets
  presets?: Partial<Record<SizePresets, Preset>>
}) {
  const [state, dispatch] = useReducer(islandReducer, {
    size: initialSize,
    previousSize: initialSize,
  })
  const presets = useMemo(() => ({ ...DEFAULT_PRESETS, ...customPresets }), [customPresets])
  const setSize = useCallback((size: SizePresets) => dispatch({ type: "SET_SIZE", size }), [])
  const value = useMemo(() => ({ state, setSize, presets }), [presets, setSize, state])

  return (
    <DynamicIslandContext.Provider value={value}>
      {children}
    </DynamicIslandContext.Provider>
  )
}

export function useDynamicIslandSize() {
  const context = useContext(DynamicIslandContext)
  if (!context) {
    throw new Error("useDynamicIslandSize must be used within a DynamicIslandProvider")
  }
  return context
}

export function DynamicIsland({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id: string
}) {
  const willChange = useWillChange()
  const { presets, state } = useDynamicIslandSize()
  const currentSize = presets[state.size]
  const width = currentSize.width
  const height = currentSize.aspectRatio * width

  return (
    <motion.div
      id={id}
      animate={{
        width,
        height,
        borderRadius: currentSize.borderRadius,
      }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.62 }}
      style={{ willChange }}
      className={cn("mx-auto flex items-center justify-center overflow-hidden", className)}
    >
      {children}
    </motion.div>
  )
}

export function DynamicContainer({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const willChange = useWillChange()

  return (
    <motion.div
      layout
      style={{ willChange }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
