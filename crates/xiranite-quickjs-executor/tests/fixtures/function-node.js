/**
 * Fixture: a node that publishes definition-named node functions next to its `run`.
 *
 * `packages/node-definitions` declares a danger gate and a preview as *data* that names an export by
 * string (`Rule::Custom { export_name }`, `DangerGate::PluginExport`), so the registry's
 * `call_function(id, function, input)` has to resolve those names through the same mechanism `run`
 * uses. This fixture is what proves the resolution — and the answer shapes are the ones a face
 * renders: a boolean as text for `isDangerous`, lines for `preview`.
 */
export function run(input, runtime, onEvent) {
  onEvent({ type: "log", message: "function fixture ran" });
  return { success: true, message: "function fixture", data: { action: input.action } };
}

export function createRuntime() {
  return { name: "function-fixture" };
}

export function isDangerous(input) {
  // A scalar answer: the definition language reads it as the string "true"/"false".
  return input && input.action === "dissolve";
}

export function preview(input) {
  const rows = (input && Array.isArray(input.names) ? input.names : []).slice(0, 3);
  return { rows, count: rows.length };
}

export function normalizeName(input) {
  // A bundle answer that is already text crosses verbatim.
  return String(input.value).trim().toLowerCase();
}
