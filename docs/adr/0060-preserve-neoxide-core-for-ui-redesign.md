---
status: accepted
---

# Preserve Neoxide's existing behavior while redesigning its egui interface

Neoxide, the mImageViewer-derived application, is the target of this UI migration.
Keep its egui framework and reuse its existing application behavior, media
processing, persistence, workers, and native GPU paths while rebuilding the
interface from Xiranite NeoView's React swimlane/sidebar layout and interactions,
with suitable entry points for Neoxide-specific features, and fully rebuilding
internationalization.
The user chose this boundary because Neoxide already implements most required
features; moving those features into Xiranite's React/Wails application would
introduce a separate behavior migration that does not serve the requested UI work.

Existing Japanese and Simplified Chinese translations are reusable input for
proper semantic-key localization; all application text call sites and the
source-string lookup mechanism will be replaced. Reusing application behavior
does not preserve the old localization architecture. UI changes must retain stable command, setting, and widget
identities and preserve existing feature entry points through an explicit mapping.
Presentation code that currently performs application work may need a narrow
separation of responsibilities; this decision does not authorize replacing the
domain implementation with duplicate frontend logic.

This records the confirmed target and reuse boundary. Browser rendering and session
ownership are recorded in [ADR-0061](0061-render-neoxide-clients-locally-with-independent-sessions.md),
and localization in [ADR-0062](0062-use-semantic-messages-for-neoxide-i18n.md).
The macOS delivery matrix and implementation validation remain in
[the design interview](../ui-migration-interview.md).
