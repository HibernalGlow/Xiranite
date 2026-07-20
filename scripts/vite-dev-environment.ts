export type ViteDevelopmentMode = "default" | "lean"

const LEAN_VITE_HEAP_MB = 1024
const MAX_OLD_SPACE_SIZE = /(?:^|\s)--max-old-space-size(?:=|\s+)\d+(?=\s|$)/

type Environment = Record<string, string | undefined>

/**
 * Lean mode trades React Compiler transforms for a bounded Vite heap. It is
 * intended for long-lived HMR sessions on memory-constrained machines.
 */
export function viteDevelopmentEnvironment(
  mode: ViteDevelopmentMode = "default",
  environment: Environment = Bun.env,
): Environment {
  if (mode === "default") return { ...environment }

  const nodeOptions = environment.NODE_OPTIONS?.trim() ?? ""
  return {
    ...environment,
    XIRANITE_REACT_COMPILER_MODE: "off",
    NODE_OPTIONS: MAX_OLD_SPACE_SIZE.test(nodeOptions)
      ? nodeOptions
      : `${nodeOptions} --max-old-space-size=${leanViteHeapMb(environment)}`.trim(),
  }
}

function leanViteHeapMb(environment: Environment): number {
  const value = environment.XIRANITE_VITE_HEAP_MB
  if (value === undefined || value.trim() === "") return LEAN_VITE_HEAP_MB

  const heapMb = Number(value)
  if (!Number.isSafeInteger(heapMb) || heapMb < 512) {
    throw new Error("XIRANITE_VITE_HEAP_MB must be an integer of at least 512.")
  }
  return heapMb
}
