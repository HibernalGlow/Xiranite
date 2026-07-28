---
status: accepted
---

# Reserve one public backend gateway namespace

Xiranite reserves `/_xiranite/backend/*` on a frontend host origin as the only
public namespace owned by its Bun backend gateway. Wails and Vite route every
request in that namespace to Bun after removing the reserved prefix; all other
paths remain owned by the frontend host. Public backend base URLs include the
reserved prefix, while direct Bun connections keep their ordinary listener
URL. This separates route ownership without exposing Bun's dynamic port or
requiring each backend feature to register another gateway prefix.

## Considered options

- **Keep per-feature gateway allowlists.** Rejected because the Wails and Vite
  lists drift whenever a backend adds a new top-level route, causing valid API
  requests to fall through to unrelated frontend asset handlers.
- **Proxy every path except a frontend denylist.** Rejected because Wails and
  Vite own different and evolving asset/runtime paths. Unknown paths would
  have ambiguous ownership, and future backend endpoints would become
  browser-accessible by default.
- **Use a second browser origin for Bun.** Rejected because it adds WebView2
  interception, CORS, and media-loading complexity without improving the path
  boundary.

## Consequences

Backend URL builders must preserve an existing base path so JSON requests,
event streams, exports, images, media ranges, and generated Reader asset URLs
all pass through the namespace. The gateway strips only the exact reserved
prefix and preserves the remaining escaped path, query, method, headers, body,
range semantics, and response. Legacy unprefixed paths are frontend-owned once
the change ships; direct backend and CLI callers remain unchanged because
their base URL has no gateway path.
