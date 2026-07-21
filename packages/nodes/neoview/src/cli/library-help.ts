export function formatCliHelp(): string {
  return [
    "NeoView library CLI",
    "",
    "Usage:",
    "  xneoview history [--limit N] [--offset N] [--filter TYPE] [--database PATH] [--json]",
    "  xneoview bookmarks [--list ID] [--limit N] [--offset N] [--filter TYPE] [--database PATH] [--json]",
    "  xneoview bookmark-lists [--database PATH] [--json]",
    "  xneoview stats [--database PATH] [--json]",
    "",
    "The CLI intentionally exposes library metadata only. Open images and books in the NeoView GUI.",
  ].join("\n")
}
