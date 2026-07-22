export type ReactCompilerMode = "annotation" | "infer" | "off"

type ViteCommand = "build" | "serve"
type Environment = Record<string, string | undefined>

export function reactCompilerModeForCommand(command: ViteCommand, environment: Environment = process.env): ReactCompilerMode {
  if (command === "serve" && environment.XIRANITE_REACT_COMPILER_DIAGNOSTIC !== "1") return "off"

  const mode = environment.XIRANITE_REACT_COMPILER_MODE ?? (command === "build" ? "infer" : "off")
  if (mode !== "annotation" && mode !== "infer" && mode !== "off") {
    throw new Error("XIRANITE_REACT_COMPILER_MODE must be annotation, infer, or off")
  }
  return mode
}
