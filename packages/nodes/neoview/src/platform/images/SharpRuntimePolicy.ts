const ENABLED_VALUES = new Set(["1", "true", "yes", "on"])

/**
 * Sharp is temporarily opt-in for NeoView. Keep the switch at the platform
 * composition boundary so browser-supported assets continue over the original
 * loopback HTTP route without loading libvips.
 */
export function isNeoViewSharpEnabled(
  value = process.env.XIRANITE_NEOVIEW_SHARP,
): boolean {
  return value !== undefined && ENABLED_VALUES.has(value.trim().toLowerCase())
}
