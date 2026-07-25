import { extractEmbeddedNativeBinding, resolveNativeBindingPath } from "@xiranite/native-loader"
import { resolve } from "node:path"

export function resolveCzkawkaBindingPath(packageRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveNativeBindingPath({
    id: "czkawka",
    filename: `xiranite-czkawka.${process.platform}-${process.arch}.node`,
    overrideEnv: "XIRANITE_CZKAWKA_NATIVE_PATH",
    workspaceRoot: resolve(packageRoot, "..", ".."),
    env,
  })
}

export function extractEmbeddedCzkawkaBinding(assetRoot: string, cacheRoot: string): string {
  return extractEmbeddedNativeBinding(assetRoot, cacheRoot, "czkawka")
}
