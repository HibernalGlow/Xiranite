---
status: accepted
---

# Coordinate NeoView deletion with canonical activation identities

NeoView returns a canonical activation identity with every opened, reloaded, or adjacent Reader session. The identity keeps the internal Reader source, the user-visible activated entry, the traversal root, and self-terminal state together. Deletion captures an immutable target from that identity or from an explicit File Card command; it must never infer the target later from penetration settings, media metadata, path ancestry, inline expansion, or whichever session happens to be current.

Deletion and undo triggers share one transaction coordinator. Existing `p-queue` 9.3.1 serializes competing commands, existing `@xstate/store` 4.2.2 exposes the transaction lifecycle, and `@xiranite/file-operations` remains the sole owner of filesystem mutation, recycle-bin receipts, persistent undo journals, and stale-path protection. Xiranite continues to own Reader session release, adjacent-session preparation, rollback, action-sequence outcomes, and Folder/Library mutation publication because those are NeoView domain semantics rather than general scheduling or file-operation infrastructure.

An immediately following next-book or previous-book action may prepare a replacement session before mutation so Windows handles are released. The original deletion target remains immutable; a successful replacement carries its own activation identity, consumes that follow-up action once, and becomes the only identity used by later commands. Failure closes the prepared replacement and restores the original session identity. Successful deletion and undo publish the same file-mutation event so File Card and library consumers refresh from one source.
