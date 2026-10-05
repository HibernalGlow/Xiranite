/**
 * A module the panel loads only when someone clicks — so the build puts it in a separate chunk.
 *
 * Its only job is to answer §6's still-open question: the host enforces pins in the runtime's `fetch`
 * hook, but nothing yet proved a *lazily* fetched chunk walks through that same hook. This file is the
 * probe, not a feature.
 */
export const LAZY_TEXT = "XR-LAZY-9142"
