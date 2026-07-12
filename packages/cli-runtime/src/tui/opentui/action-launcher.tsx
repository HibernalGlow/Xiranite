/* @jsxImportSource @opentui/react */
import type { InteractionField } from "../../interaction.js"
import type { TerminalUiSession } from "../session.js"
import { ActionTabs } from "./action-tabs.js"

/** One-click action strip: selecting an action immediately runs it or opens its safety confirmation. */
export function ActionLauncher<Result>({ field, session, disabled }: { field: InteractionField; session: TerminalUiSession<Result>; disabled?: boolean }) {
  return <ActionTabs id={field.id} options={field.options ?? []} value={session.values[field.id]} focused={session.focusedControlId === field.id} disabled={disabled ?? session.phase === "running"} onFocus={() => session.focus(field.id)} onChange={(value) => void session.requestAction(field.id, value)} />
}
