/**
 * 窗口控制 hook。
 *
 * 封装与后端窗口管理 API 的交互，提供：
 * - capabilities — 当前平台支持的窗口操作能力（如是否支持多窗口、是否支持 taskbar 自定义等）；
 * - controlMain — 控制主窗口（最小化/最大化/恢复/关闭等）；
 * - openComponent — 在独立窗口中打开某个组件（多窗口模式）；
 * - closeComponent — 关闭指定组件窗口。
 *
 * 查询用 useQuery（capabilities 只读），变更用 useMutation（控制类操作）。
 * 每个 mutation 都暴露 mutateAsync 与 isPending，便于调用方 await 结果与显示 loading。
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import { getBackend } from "@/backend/client"
import type { MainWindowAction, OpenComponentWindowInput, WindowCommandResult } from "@/backend/runtime/runtime"

export function useWindowControls() {
  const capabilitiesQuery = useQuery({
    queryKey: ["window-capabilities"],
    queryFn: async () => {
      const backend = await getBackend()
      return backend.windows.getCapabilities()
    },
  })

  const controlMainMutation = useMutation({
    mutationFn: async (action: MainWindowAction): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.controlMain(action)
    },
  })

  const openComponentMutation = useMutation({
    mutationFn: async (input: OpenComponentWindowInput): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.openComponent(input)
    },
  })

  const closeComponentMutation = useMutation({
    mutationFn: async (id: string): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.close(id)
    },
  })

  return {
    capabilities: capabilitiesQuery.data,
    capabilitiesPending: capabilitiesQuery.isPending,
    controlMain: controlMainMutation.mutateAsync,
    controlMainPending: controlMainMutation.isPending,
    openComponent: openComponentMutation.mutateAsync,
    openComponentPending: openComponentMutation.isPending,
    closeComponent: closeComponentMutation.mutateAsync,
    closeComponentPending: closeComponentMutation.isPending,
  }
}
