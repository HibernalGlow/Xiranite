import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type * as RegistryJs from "registry-js"

import type { WindowsRegistryAdapter, WindowsRegistryHive, WindowsRegistryTarget } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeWindowsRegistryAdapter(): WindowsRegistryAdapter {
  return {
    async createKey(target) {
      const registry = await loadRegistryJs()
      if (!registry.createKey(registryHkey(registry, target.hive), target.subkey)) {
        throw new Error(`registry-js could not create ${formatRegistryTarget(target)}`)
      }
    },
    async setStringValue(target, valueName, value) {
      const registry = await loadRegistryJs()
      if (!registry.setValue(registryHkey(registry, target.hive), target.subkey, valueName, registry.RegistryValueType.REG_SZ, value)) {
        throw new Error(`registry-js could not set ${formatRegistryTarget(target)}`)
      }
    },
    async deleteKey(registryPath, signal) {
      try {
        const result = await execFileAsync("reg.exe", ["delete", registryPath, "/f"], { windowsHide: true, encoding: "utf8", signal })
        return { code: 0, stdout: result.stdout, stderr: result.stderr }
      } catch (cause) {
        const error = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
        return { code: typeof error.code === "number" ? error.code : 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message }
      }
    },
  }
}

type RegistryJsModule = typeof RegistryJs

async function loadRegistryJs(): Promise<RegistryJsModule> {
  return import("registry-js")
}

function registryHkey(registry: RegistryJsModule, hive: WindowsRegistryHive): RegistryJs.HKEY {
  if (hive === "HKCU") return registry.HKEY.HKEY_CURRENT_USER
  if (hive === "HKCR") return registry.HKEY.HKEY_CLASSES_ROOT
  return registry.HKEY.HKEY_LOCAL_MACHINE
}

function formatRegistryTarget(target: WindowsRegistryTarget): string {
  return `${target.hive}\\${target.subkey}`
}
