---
status: accepted
---

# Route external launches through declared complete node hosts

Xiranite accepts external node-launch requests through a global `xiranite://` protocol and an argv transport for Windows Explorer. Both normalize to one versioned request and route only to a node that explicitly declares the intent. The launcher starts or reuses a complete node launch host for that node; it does not open the full workspace or interpret NeoView-specific reader/folder behavior. This is deliberately different from pointing Explorer at an individual frozen Node App executable: normal installation has one stable desktop entry point, while Node Apps remain independently packaged release artifacts.

The chosen boundary keeps `@xiranite/contract` platform-neutral, puts Windows registry and process adapters behind a shared Shell Integration boundary, and lets Owithu and NeoView consume that boundary as peer nodes. Owithu is not a runtime dependency of NeoView. The existing NeoView-private Explorer registrar is superseded because it cannot own a generic launch protocol, per-extension eligibility, managed-key ownership, or the direct-node lifecycle.

## Considered options

### Route every request through the workspace

Rejected. A workspace is a user composition surface, not a node-launch protocol owner. It would preload unrelated nodes, make path opening dependent on current workspace state, and still leave other nodes without a direct launch model.

### Register every node's frozen Node App executable

Rejected for normal external launches. Node App executables are versioned release artifacts that may not be installed, and executable discovery would couple a user-level Shell key to a particular snapshot. The launcher can later choose a Node App as a declared host mode without changing the public request contract.

### Make Owithu the system-service node

Rejected. Owithu is a peer, user-facing TOML workflow. Its useful registry-plan and quoting behavior moves behind a shared adapter; node-to-node ownership would invert the project boundary and create a hidden runtime dependency.

## Consequences

Nodes opt in through a serializable external-launch declaration. A missing declaration, unsupported target, missing required capability, or unavailable host fails closed with a visible desktop diagnostic. Node hosts may lazy-load, but every capability in the declaration must be present before acknowledging an external request.

The global protocol is independent of node-specific Explorer menus. NeoView's initial integration is user-level, opt-in, and uses managed keys only. It supports one local or UNC file URI/path per request; files enter Reader and directories enter Folder. Its menu registration derives from the effective media configuration plus supported archive formats, synchronizes after configuration changes, and removes only owned keys when disabled. Traditional Windows Shell verbs are the first release surface; Windows 11 first-level COM commands remain a separate native integration project.
