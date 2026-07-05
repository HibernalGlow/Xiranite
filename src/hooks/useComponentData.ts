import { useCallback, useMemo } from "react"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"

/**
 * useComponentData — 让模块把状态持久化到 store 的 comp.data。
 *
 * 解决的痛点：
 * 三种 viewMode（cards / dockview / flow）切换时，ModuleRenderer 会被
 * 卸载/重新挂载。如果模块用 useState 存数据（如 EngineVModule 的扫描结果），
 * 切换 viewMode 后状态全部丢失。
 *
 * 用法：
 *   const [data, setData] = useComponentData<EngineVState>(compId)
 *   setData({ result: scanResult })
 *   // 切 viewMode 再切回来，data.result 仍在
 *
 * setData 支持部分更新（浅合并），行为类似类组件的 this.setState。
 *
 * 持久化链路：
 * - 模块 setData → dispatch PATCH_COMPONENT_DATA → store 更新 comp.data
 * - store 的 useEffect 监听 components 变化 → debounce 写回 backend
 * - web runtime → localStorage；electbun runtime → ~/.xiranite/storage.json
 *
 * 这样模块状态在三种 viewMode 间完全共享，且跨会话持久化。
 */
export function useComponentData<T extends object>(
  compId: string,
): [T, (patch: Partial<T>) => void] {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()

  const comp = state.components.find(c => c.id === compId)
  const data = (comp?.data ?? {}) as T

  const setData = useCallback(
    (patch: Partial<T>) => {
      dispatch(actions.patchComponentData(compId, patch as Record<string, unknown>))
    },
    [compId, dispatch],
  )

  // 用 useMemo 稳定引用，避免每次都新建对象（除非 data 真的变了）
  const stableData = useMemo(() => data, [data])

  return [stableData, setData]
}
