# ClipM dependency record

Phase 1 freezes only the protocol and SQLite boundary. Model, MCP, archive, and
locking dependencies are intentionally deferred to the phases that use them.

| Dependency | Version | License | Boundary and decision |
| --- | --- | --- | --- |
| Pydantic | 2.13.4 | MIT | Canonical Python wire models and JSON Schema generation. Mature validation avoids maintaining a second permissive metadata parser. |
| Sqids for Python | 0.5.2 | MIT | Official reversible integer short codes. ClipM fixes the Crockford alphabet, minimum length 4, and an empty blocklist for cross-version deterministic output. |
| json-schema-to-typescript | 15.0.4 | MIT | Build-only conversion of committed Pydantic JSON Schema into TypeScript declarations. It adds no application runtime cost. |
| pytest | 9.1.1 | MIT | Development-only domain and migration tests. |
| Hatchling | 1.31.0 | MIT | PEP 517 build backend used by UV for the `src/` Python package. |
| MCP Python SDK | 2.0.0 | MIT | Official stdio server and tool schema implementation; no custom JSONL protocol. |
| MCP TypeScript SDK | 1.30.0 | MIT | Official stdio client, request IDs, cancellation, progress, and protocol errors. Node-only dependency with no browser bundle path. |
| Portalocker | 3.2.0 | BSD-3-Clause | Maintained Windows cross-process locks for database migration and later GPU/archive/model critical sections. |
| Zod | 4.3.6 | MIT | Required peer of the official TypeScript MCP SDK; matches the version already used in the workspace. |

Windows validation is recorded by the focused commands in each phase commit.
The runtime remains external to the Wails package, so these dependencies do not
increase the desktop installer size.
