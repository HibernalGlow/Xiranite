import { packageModuleLoaders } from "../../../src/components/modules/packageModules.generated"

const status = document.querySelector<HTMLOutputElement>("[data-neoview-module-boundary]")!

try {
  const entry = await packageModuleLoaders.neoview()
  if (typeof entry.default.Component !== "function") throw new Error("NeoView entry has no component")
  status.dataset.neoviewModuleBoundary = "ready"
  status.value = "ready"
} catch (error) {
  status.dataset.neoviewModuleBoundary = "failed"
  status.value = error instanceof Error ? error.message : String(error)
  throw error
}
