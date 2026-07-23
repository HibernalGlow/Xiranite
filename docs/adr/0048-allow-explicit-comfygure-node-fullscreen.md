---
status: accepted
---

# Allow explicit Comfygure node fullscreen

Comfygure opens at ordinary Xiranite node dimensions by default. When the user explicitly chooses to maximize its node window, it may opt into the same host-provided fullscreen maximize behavior used by NeoView. This is a presentation convenience for the heavy node projection, not permission to create an independent application surface, route, or window lifecycle.

All Comfygure state continues to be owned by its node, backend services, and persisted Program/Run contracts. Closing, restoring, or resizing the node follows the existing Xiranite node-window contract.
