import { Eye, ShieldMinus, ShieldPlus } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { OwithuAction, RegistryHive } from "@xiranite/node-owithu/core"

export interface OwithuActionMeta {
  value: OwithuAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  destructive: boolean
}

export const ACTIONS: OwithuActionMeta[] = [
  {
    value: "preview",
    label: "扫描预览",
    shortLabel: "预览",
    description: "解析 TOML 配置并生成注册表计划，但不写入任何注册表项。",
    icon: Eye,
    destructive: false,
  },
  {
    value: "register",
    label: "注册菜单",
    shortLabel: "注册",
    description: "按计划向 Windows 注册表写入右键菜单项，需要相应权限。",
    icon: ShieldPlus,
    destructive: true,
  },
  {
    value: "unregister",
    label: "注销菜单",
    shortLabel: "注销",
    description: "按计划从 Windows 注册表移除右键菜单项，操作不可撤销。",
    icon: ShieldMinus,
    destructive: true,
  },
]

export const HIVES: Array<{ value: RegistryHive | ""; label: string }> = [
  { value: "", label: "默认" },
  { value: "HKCU", label: "HKCU" },
  { value: "HKCR", label: "HKCR" },
  { value: "HKLM", label: "HKLM" },
]
