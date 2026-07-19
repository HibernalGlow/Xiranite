import {
  matchingReaderInputBinding,
  readerViewAreaAtPoint,
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
  const handledAreaPressPointers = useRef(new Set<number>())
  const keyboardHoldTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const keyboardKeys = useMemo(() => config.bindings.flatMap((binding) => {
    if (!binding.enabled || binding.input.device !== "keyboard") return []
    const input = binding.input
    return [[input.ctrl && "ctrl", input.alt && "alt", input.shift && "shift", input.meta && "meta", input.code].filter(Boolean).join("+")]
  }), [config.bindings])

  useHotkeys<HTMLElement>(keyboardKeys, (event) => {
    if (disabled || event.repeat || event.isComposing) return
    const input = {
      device: "keyboard",
      code: event.code,
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
      shift: event.shiftKey || undefined,
      meta: event.metaKey || undefined,
    } as const
    const handled = dispatch({ ...input, trigger: "down" }, event.target)
    const holdBinding = matchingReaderInputBinding(bindingsRef.current, { ...input, trigger: "hold" }, readerInputContexts(event.target))
    if (holdBinding) {
      const key = keyboardEventKey(event)
      const existing = keyboardHoldTimers.current.get(key)
      if (existing) clearTimeout(existing)
      keyboardHoldTimers.current.set(key, setTimeout(() => {
        keyboardHoldTimers.current.delete(key)
        void executeRef.current(holdBinding.action)
      }, holdBinding.input.device === "keyboard" ? holdBinding.input.durationMs ?? 450 : 450))
    }
    if (handled || holdBinding) event.preventDefault()
  }, {
    useKey: false,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: false,
    enabled: keyboardKeys.length > 0,
  }, [disabled, keyboardKeys])

  useHotkeys<HTMLElement>(keyboardKeys, (event) => {
    const key = keyboardEventKey(event)
    const timer = keyboardHoldTimers.current.get(key)
    if (!timer) return
    clearTimeout(timer)
    keyboardHoldTimers.current.delete(key)
  }, {
    useKey: false,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    keydown: false,
    keyup: true,
    enabled: keyboardKeys.length > 0,
  }, [keyboardKeys])

  useEffect(() => {
    const clear = () => {
      for (const timer of keyboardHoldTimers.current.values()) clearTimeout(timer)
      keyboardHoldTimers.current.clear()
    }
    window.addEventListener("blur", clear)
    if (disabled) clear()
    return () => {
      window.removeEventListener("blur", clear)
      clear()
    }
  }, [config.bindings, disabled])

  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    if (disabled || event.pointerType !== "mouse" || isInteractive(event.target)) return
    if (handledAreaPressPointers.current.delete(event.pointerId)) {
      event.preventDefault()
      return
    }
    const areaInput = readerAreaInput(event, event.detail > 1 ? "double-click" : "click")
    if (areaInput && dispatch(areaInput, event.target)) {
      event.preventDefault()
      return
    }
    if (dispatch({ device: "mouse", button: event.button, action: event.detail > 1 ? "double-click" : "click" }, event.target)) event.preventDefault()
  }

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (disabled || event.pointerType !== "mouse" || isInteractive(event.target)) return
    const input = readerAreaInput(event, "press")
    if (input && dispatch(input, event.target)) {
      handledAreaPressPointers.current.add(event.pointerId)
      event.preventDefault()
      return
    }
    if (dispatch({ device: "mouse", button: event.button, action: "press" }, event.target)) {
      handledAreaPressPointers.current.add(event.pointerId)
      event.preventDefault()
    }
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

  function claimPointer(pointerId: number): void {
    handledAreaPressPointers.current.add(pointerId)
  }

  return { claimPointer, dispatch, onPointerDown, onPointerUp }
}

function keyboardEventKey(event: KeyboardEvent): string {
  return `${event.code}:${event.ctrlKey}:${event.altKey}:${event.shiftKey}:${event.metaKey}`
}

function readerAreaInput(event: Parameters<PointerEventHandler<HTMLElement>>[0], action: "click" | "double-click" | "press"): ReaderInputDescriptor | undefined {
  if (event.button < 0 || event.button > 2) return undefined
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    device: "area",
    area: readerViewAreaAtPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height),
    button: event.button as 0 | 1 | 2,
    action,
  }
}

export function readerInputContexts(target: EventTarget | null): ReaderInputContext[] {
  if (!(target instanceof Element)) return ["reader"]
  if (isEditable(target)) return ["editor"]
  if (target.closest('[role="dialog"], [aria-modal="true"], [data-input-context="modal"]')) return ["modal"]
  if (target.closest('[data-input-context="video"]')) return ["video"]
  if (target.closest("[data-reader-panel]")) return ["panel"]
  return ["reader"]
}

export function isReaderInputInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && isInteractive(target)
}

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="combobox"]',
  '[data-slot="switch"]',
  '[data-slot="slider"]',
  '[data-input-interactive="true"]',
].join(", ")

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}

function isEditable(target: Element): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.closest('[contenteditable="true"]') !== null
}
