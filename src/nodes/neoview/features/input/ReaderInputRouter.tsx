import {
  matchingReaderInputBinding,
  type ReaderInputAction,
  type ReaderInputBindingsConfig,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import { useHotkeys } from "react-hotkeys-hook"
import { useEffect, useMemo, useRef, type PointerEventHandler } from "react"

export interface ReaderInputRouterOptions {
  config: ReaderInputBindingsConfig
  disabled?: boolean
  execute(action: ReaderInputAction): void | Promise<void>
}

export function useReaderInputRouter({ config, disabled = false, execute }: ReaderInputRouterOptions) {
  const executeRef = useRef(execute)
  executeRef.current = execute
  const bindingsRef = useRef(config.bindings)
  bindingsRef.current = config.bindings

  const keyboardKeys = useMemo(() => config.bindings.flatMap((binding) => {
    if (!binding.enabled || binding.input.device !== "keyboard") return []
    const input = binding.input
    return [[input.ctrl && "ctrl", input.alt && "alt", input.shift && "shift", input.meta && "meta", input.code].filter(Boolean).join("+")]
  }), [config.bindings])

  useHotkeys<HTMLElement>(keyboardKeys, (event) => {
    if (disabled || event.repeat || event.isComposing) return
    const handled = dispatch({
      device: "keyboard",
      code: event.code,
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
      shift: event.shiftKey || undefined,
      meta: event.metaKey || undefined,
    }, event.target)
    if (handled) event.preventDefault()
  }, {
    useKey: false,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: false,
    enabled: keyboardKeys.length > 0,
  }, [disabled, keyboardKeys])

  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    if (disabled || event.pointerType !== "mouse") return
    if (dispatch({ device: "mouse", button: event.button, click: event.detail > 1 ? "double" : "single" }, event.target)) event.preventDefault()
  }

  useEffect(() => {
    if (disabled || !config.bindings.some((binding) => binding.enabled && binding.input.device === "gamepad")) return
    let disposed = false
    let listener: import("gamepad.js").GamepadListener | undefined
    const onButton = (event: CustomEvent<import("gamepad.js").GamepadButtonEventDetail>) => {
      if (!event.detail.pressed || document.visibilityState !== "visible") return
      dispatch({ device: "gamepad", button: event.detail.button }, document.activeElement)
    }
    void import("gamepad.js").then(({ GamepadListener }) => {
      if (disposed) return
      listener = new GamepadListener({ button: { analog: false, deadZone: 0.5 } })
      listener.on("gamepad:button", onButton)
      listener.start()
    }).catch(() => undefined)
    return () => {
      disposed = true
      listener?.off("gamepad:button", onButton)
      listener?.stop()
    }
  }, [config.bindings, disabled])

  function dispatch(input: ReaderInputDescriptor, target: EventTarget | null): boolean {
    const contexts = readerInputContexts(target)
    const binding = matchingReaderInputBinding(bindingsRef.current, input, contexts)
    if (!binding) return false
    void executeRef.current(binding.action)
    return true
  }

  return { dispatch, onPointerUp }
}

export function readerInputContexts(target: EventTarget | null): ReaderInputContext[] {
  if (!(target instanceof Element)) return ["reader"]
  if (isEditable(target)) return ["editor"]
  if (target.closest('[role="dialog"], [aria-modal="true"]')) return ["modal"]
  if (target.closest("[data-reader-panel]")) return ["panel"]
  return ["reader"]
}

function isEditable(target: Element): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.closest('[contenteditable="true"]') !== null
}
