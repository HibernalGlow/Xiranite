/**
 * Workspace component restore policy.
 *
 * CardView mounts ModuleRenderer for every non-collapsed component on hydrate.
 * NeoView is heavy enough that restoring multiple instances at once can freeze
 * the main window (often visible as only one or two Neo cards partially coming
 * back). Flip this to `true` once deferred mounting / lighter restore is ready.
 *
 * When false:
 * - startup hydrates workspaces/lanes only (no component instances)
 * - component rows in SQLite are left untouched on persist
 */
export const RESTORE_WORKSPACE_COMPONENTS = false
