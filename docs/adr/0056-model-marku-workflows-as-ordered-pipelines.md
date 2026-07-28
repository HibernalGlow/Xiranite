# Model Marku workflows as ordered pipelines

**Status:** accepted, 2026-07-28

Marku workflow execution is an ordered list of text-transforming steps, not a
general directed graph. Each step snapshots a Marku module id and its JSON
configuration, consumes the preceding step's output, and stops the run on the
first failure. React Flow is the GUI editor and accessibility-enhanced visual
projection of that list; its nodes, edges, positions, and viewport must never
become the execution source of truth.

## Considered options

- **Persist and execute arbitrary React Flow graphs.** Rejected: joins,
  branches, cycles, partial failure, and multi-input semantics would all need
  contracts that Marku's current text modules do not have.
- **Keep a hand-written list editor.** Rejected: Xiranite already carries
  maintained `@xyflow/react`, and a visible step graph is the intended
  workflow experience.
- **Store the graph as the canonical workflow.** Rejected: UI layout changes
  would change execution semantics and make CLI execution unnecessarily
  framework-dependent.

## Consequences

The pure Marku core owns workflow validation, normalization, sequential
execution, deferred write-back, and step results. The GUI maps the ordered
steps to a linear React Flow canvas and provides a keyboard-accessible list
editor. CLI can run the same workflow contract; the existing TUI remains
truthfully single-step until it has a dedicated workflow editor.
