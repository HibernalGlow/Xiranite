import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  InteractionField,
  InteractionValue,
  InteractionValues,
  TerminalInteractionDefinition,
  TerminalInteractionSchema,
} from "../interaction.js"

export type TerminalUiPhase = "editing" | "preview" | "running" | "result"

export interface TerminalUiSession<Result> {
  phase: TerminalUiPhase
  values: InteractionValues
  fields: readonly InteractionField[]
  field?: InteractionField
  fieldIndex: number
  fieldValue?: InteractionValue
  error?: string
  preview: readonly string[]
  dangerous: boolean
  progress: number
  status: string
  logs: readonly string[]
  result?: Result
  resultSummary?: {
    success: boolean
    message: string
    lines: readonly string[]
  }
  changeValue: (value: InteractionValue) => void
  submitValue: (value: InteractionValue) => void
  back: () => boolean
  execute: () => Promise<void>
  cancel: () => void
  reset: () => void
}

interface TerminalUiState<Result> {
  phase: TerminalUiPhase
  values: InteractionValues
  fieldIndex: number
  error?: string
  progress: number
  status: string
  logs: string[]
  result?: Result
  fatalError?: string
}

export function visibleInteractionFields<Input, Result>(
  schema: TerminalInteractionSchema<Input, Result>,
  values: Readonly<InteractionValues>,
): readonly InteractionField[] {
  return schema.fields.filter((field) => field.visibleWhen?.(values) ?? true)
}

export function useTerminalUiSession<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
): TerminalUiSession<Result> {
  const { schema } = definition
  const mountedRef = useRef(true)
  const [state, setState] = useState<TerminalUiState<Result>>(() => initialState(schema))
  const fields = visibleInteractionFields(schema, state.values)
  const fieldIndex = Math.min(state.fieldIndex, Math.max(0, fields.length - 1))
  const field = fields[fieldIndex]
  const input = useMemo(() => schema.toInput(state.values), [schema, state.values])
  const preview = state.phase === "preview" ? schema.preview(input) : []
  const dangerous = state.phase === "preview" && schema.isDangerous(input)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const changeValue = useCallback((value: InteractionValue) => {
    setState((current) => {
      const currentFields = visibleInteractionFields(schema, current.values)
      const currentField = currentFields[Math.min(current.fieldIndex, Math.max(0, currentFields.length - 1))]
      if (!currentField) return current
      return {
        ...current,
        values: { ...current.values, [currentField.id]: value },
        error: undefined,
      }
    })
  }, [schema])

  const submitValue = useCallback((value: InteractionValue) => {
    setState((current) => {
      const currentFields = visibleInteractionFields(schema, current.values)
      const currentIndex = Math.min(current.fieldIndex, Math.max(0, currentFields.length - 1))
      const currentField = currentFields[currentIndex]
      if (!currentField) return current

      const normalizedValue = normalizeFieldValue(currentField, value)
      const nextValues = { ...current.values, [currentField.id]: normalizedValue }
      const validationError = currentField.validate?.(normalizedValue, nextValues) ?? null
      if (validationError) return { ...current, values: nextValues, error: validationError }

      const nextFields = visibleInteractionFields(schema, nextValues)
      if (currentIndex < nextFields.length - 1) {
        return { ...current, values: nextValues, fieldIndex: currentIndex + 1, error: undefined }
      }

      const nextInput = schema.toInput(nextValues)
      const formError = schema.validate?.(nextValues, nextInput) ?? null
      if (formError) return { ...current, values: nextValues, error: formError }
      return { ...current, values: nextValues, phase: "preview", error: undefined }
    })
  }, [schema])

  const back = useCallback((): boolean => {
    if (state.phase === "preview") {
      setState((current) => {
        const currentFields = visibleInteractionFields(schema, current.values)
        return { ...current, phase: "editing", fieldIndex: Math.max(0, currentFields.length - 1), error: undefined }
      })
      return true
    }
    if (state.phase === "result") {
      setState(initialState(schema))
      return true
    }
    if (state.phase === "editing" && state.fieldIndex > 0) {
      setState((current) => ({ ...current, fieldIndex: Math.max(0, current.fieldIndex - 1), error: undefined }))
      return true
    }
    return false
  }, [schema, state.fieldIndex, state.phase])

  const execute = useCallback(async (): Promise<void> => {
    const values = state.values
    const executionInput = schema.toInput(values)
    const validationError = schema.validate?.(values, executionInput) ?? null
    if (validationError) {
      setState((current) => ({ ...current, error: validationError }))
      return
    }

    setState((current) => ({
      ...current,
      phase: "running",
      error: undefined,
      fatalError: undefined,
      progress: 0,
      status: "Starting...",
      logs: [],
      result: undefined,
    }))

    try {
      const result = await definition.run(executionInput, (event) => {
        if (!mountedRef.current) return
        setState((current) => ({
          ...current,
          progress: event.type === "progress" ? clampProgress(event.progress ?? current.progress) : current.progress,
          status: event.message || current.status,
          logs: event.message.trim() ? [...current.logs, event.message].slice(-100) : current.logs,
        }))
      })
      if (!mountedRef.current) return
      const summary = schema.result(result)
      setState((current) => ({
        ...current,
        phase: "result",
        progress: summary.success ? 100 : current.progress,
        status: summary.message,
        result,
      }))
    } catch (error) {
      if (!mountedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setState((current) => ({
        ...current,
        phase: "result",
        status: message,
        fatalError: message,
        logs: [...current.logs, message].slice(-100),
      }))
    }
  }, [definition, schema, state.values])

  const cancel = useCallback(() => {
    definition.cancel?.()
  }, [definition])

  const reset = useCallback(() => {
    setState(initialState(schema))
  }, [schema])

  const resultSummary = state.fatalError
    ? { success: false, message: state.fatalError, lines: [] as readonly string[] }
    : state.result === undefined
      ? undefined
      : (() => {
          const summary = schema.result(state.result)
          return { ...summary, lines: summary.lines ?? [] }
        })()

  return {
    phase: state.phase,
    values: state.values,
    fields,
    field,
    fieldIndex,
    fieldValue: field ? state.values[field.id] : undefined,
    error: state.error,
    preview,
    dangerous,
    progress: state.progress,
    status: state.status,
    logs: state.logs,
    result: state.result,
    resultSummary,
    changeValue,
    submitValue,
    back,
    execute,
    cancel,
    reset,
  }
}

function initialState<Input, Result>(schema: TerminalInteractionSchema<Input, Result>): TerminalUiState<Result> {
  return {
    phase: "editing",
    values: { ...schema.initialValues },
    fieldIndex: 0,
    progress: 0,
    status: "Ready",
    logs: [],
  }
}

function normalizeFieldValue(field: InteractionField, value: InteractionValue): InteractionValue {
  if (field.kind !== "number") return value
  if (typeof value === "number") return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)))
}
