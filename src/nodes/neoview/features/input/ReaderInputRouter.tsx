import {
  matchingReaderInputBinding,
  ReaderInputActionSequenceRunner,
  READER_INPUT_CONTEXTS,
  readerViewAreaAtPoint,
  type ReaderInputAction,
  type ReaderInputActionExecutionContext,
  type ReaderInputActionOutcome,
  type ReaderInputActionSequenceResult,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import { useHotkeys } from "react-hotkeys-hook"
import { useEffect, useMemo, useRef, type PointerEventHandler } from "react"
import type { ReaderInputExecutionContext, ReaderInputInvocation } from "./ReaderInputInvocation"

export interface ReaderInputRouterOptions {
  config: ReaderInputBindingsConfig
  disabled?: boolean
  execute(action: ReaderInputAction, context: ReaderInputExecutionContext): ReaderInputActionOutcome | void | Promise<ReaderInputActionOutcome | void>
}

export const READER_POINTER_DOUBLE_CLICK_WINDOW_MS = 300
const READER_POINTER_DOUBLE_CLICK_MOVE_TOLERANCE_PX = 12

interface PendingPointerClick {
  button: number
  clickBinding?: ReaderInputBinding
  clientX: number
  clientY: number
  doubleClickBindingId: string
  timer?: ReturnType<typeof setTimeout>
}

export function useReaderInputRouter({ config, disabled = false, execute }: ReaderInputRouterOptions) {
  const executeRef = useRef(execute)
  executeRef.current = execute
  const sequenceRunner = useRef(new ReaderInputActionSequenceRunner())
  const bindingsRef = useRef(config.bindings)
  bindingsRef.current = config.bindings
  const handledPointers = useRef(new Set<number>())
  const pendingPointerClick = useRef<PendingPointerClick | undefined>(undefined)
  const keyboardHoldTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const keyboardRepeatBindings = useRef(new Map<string, ReaderInputBinding | null>())
  const keyboardRepeatBindingSource = useRef(config.bindings)
  const invocationSequence = useRef(0)

  const keyboardKeys = useMemo(() => config.bindings.flatMap((binding) => {
    if (!binding.enabled || binding.input.device !== "keyboard") return []
    const input = binding.input
    return [[input.ctrl && "ctrl", input.alt && "alt", input.shift && "shift", input.meta && "meta", input.code].filter(Boolean).join("+")]
  }), [config.bindings])

  useHotkeys<HTMLElement>(keyboardKeys, (event) => {
    if (disabled || event.isComposing) return
    if (keyboardRepeatBindingSource.current !== bindingsRef.current) {
      keyboardRepeatBindings.current.clear()
      keyboardRepeatBindingSource.current = bindingsRef.current
    }
    const input = {
      device: "keyboard",
      code: event.code,
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
      shift: event.shiftKey || undefined,
      meta: event.metaKey || undefined,
    } as const
    let downBinding = keyboardRepeatBindings.current.get(event.code)
    if (!event.repeat || downBinding === undefined) {
      downBinding = matchingReaderInputBinding(bindingsRef.current, { ...input, trigger: "down" }, readerInputContexts(event.target)) ?? null
      keyboardRepeatBindings.current.set(event.code, downBinding)
    }
    const handled = executeBinding(downBinding, event.repeat)

    const holdBinding = event.repeat
      ? undefined
      : matchingReaderInputBinding(bindingsRef.current, { ...input, trigger: "hold" }, readerInputContexts(event.target))
    if (holdBinding) {
      const key = keyboardEventKey(event)
      const existing = keyboardHoldTimers.current.get(key)
      if (existing) clearTimeout(existing)
      keyboardHoldTimers.current.set(key, setTimeout(() => {
        keyboardHoldTimers.current.delete(key)
        void sequenceRunner.current.run(holdBinding, executeRef.current)
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
    keyboardRepeatBindings.current.delete(event.code)
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
      keyboardRepeatBindings.current.clear()
      clearPendingPointerClick()
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
    if (handledPointers.current.delete(event.pointerId)) {
      event.preventDefault()
      return
    }

    const clickBinding = pointerBinding(event, "click")
    const doubleClickBinding = pointerBinding(event, "double-click")
    const pending = pendingPointerClick.current
    if (pending && doubleClickBinding?.id === pending.doubleClickBindingId && samePointerClick(pending, event)) {
      clearPendingPointerClick()
      executeBinding(doubleClickBinding)
      event.preventDefault()
      return
    }

    if (pending) commitPendingPointerClick()
    if (doubleClickBinding) {
      const next: PendingPointerClick = {
        button: event.button,
        clickBinding,
        clientX: event.clientX,
        clientY: event.clientY,
        doubleClickBindingId: doubleClickBinding.id,
      }
      next.timer = setTimeout(() => {
        if (pendingPointerClick.current !== next) return
        pendingPointerClick.current = undefined
        executeBinding(next.clickBinding)
      }, READER_POINTER_DOUBLE_CLICK_WINDOW_MS)
      pendingPointerClick.current = next
      event.preventDefault()
      return
    }
    if (executeBinding(clickBinding)) event.preventDefault()
  }

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (disabled || event.pointerType !== "mouse" || isInteractive(event.target)) return
    if (executeBinding(pointerBinding(event, "press"))) {
      handledPointers.current.add(event.pointerId)
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

  function dispatch(input: ReaderInputDescriptor, target: EventTarget | null, invocation?: ReaderInputInvocation): boolean {
    const contexts = readerInputContexts(target)
    const binding = matchingReaderInputBinding(bindingsRef.current, input, contexts)
    return executeBinding(binding, false, invocation)
  }

  function dispatchAndWait(
    input: ReaderInputDescriptor,
    target: EventTarget | null,
    invocation?: ReaderInputInvocation,
  ): Promise<ReaderInputActionSequenceResult | undefined> {
    const contexts = readerInputContexts(target)
    const binding = matchingReaderInputBinding(bindingsRef.current, input, contexts)
    return runBinding(binding, false, invocation)
  }

  function pointerBinding(
    event: Parameters<PointerEventHandler<HTMLElement>>[0],
    action: "click" | "double-click" | "press",
  ): ReaderInputBinding | undefined {
    const contexts = readerInputContexts(event.target)
    const areaInput = readerAreaInput(event, action)
    return (areaInput ? matchingReaderInputBinding(bindingsRef.current, areaInput, contexts) : undefined)
      ?? matchingReaderInputBinding(bindingsRef.current, { device: "mouse", button: event.button, action }, contexts)
  }

  function executeBinding(
    binding: ReaderInputBinding | null | undefined,
    repeat = false,
    invocation?: ReaderInputInvocation,
  ): boolean {
    const running = runBinding(binding, repeat, invocation)
    if (!running) return false
    void running
    return true
  }

  function runBinding(
    binding: ReaderInputBinding | null | undefined,
    repeat = false,
    invocation?: ReaderInputInvocation,
  ): Promise<ReaderInputActionSequenceResult> | undefined {
    if (!binding || (repeat && binding.ignoreRepeat)) return undefined
    const execute = invocation
      ? (action: ReaderInputAction, context: ReaderInputActionExecutionContext) => executeRef.current(action, { ...context, invocation })
      : executeRef.current
    const singleFlightKey = invocation ? `${binding.id}:invocation:${++invocationSequence.current}` : binding.id
    return sequenceRunner.current.run(binding, execute, singleFlightKey)
  }

  function claimPointer(pointerId: number): void {
    handledPointers.current.add(pointerId)
  }

  function clearPendingPointerClick(): void {
    const pending = pendingPointerClick.current
    if (pending?.timer) clearTimeout(pending.timer)
    pendingPointerClick.current = undefined
  }

  function commitPendingPointerClick(): void {
    const pending = pendingPointerClick.current
    if (!pending) return
    clearPendingPointerClick()
    executeBinding(pending.clickBinding)
  }

  return { claimPointer, dispatch, dispatchAndWait, onPointerDown, onPointerUp }
}

function samePointerClick(
  pending: PendingPointerClick,
  event: Parameters<PointerEventHandler<HTMLElement>>[0],
): boolean {
  return pending.button === event.button
    && Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) <= READER_POINTER_DOUBLE_CLICK_MOVE_TOLERANCE_PX
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
  const explicit = target.closest<HTMLElement>("[data-input-context]")?.dataset.inputContext
  if (READER_INPUT_CONTEXTS.includes(explicit as ReaderInputContext)) return [explicit as ReaderInputContext]
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
