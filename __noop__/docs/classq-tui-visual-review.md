# ClassQ TUI visual review

## Evidence

- GUI reference/final comparison: `output/playwright/classq/classq-reference-review.jpg`
- OpenTUI PTY capture: `artifacts/cli/classq/routing-topology.png`

## Layout correspondence

| GUI workbench | OpenTUI workbench |
| --- | --- |
| input and rule rail | roots, keyword folder, wait folder, transfer and dry-run controls |
| routing canvas | Unicode tree topology from keyword folders to their wait targets |
| result table | scrollable plan rows with ready/conflict/error state and target-relative path |
| classify action | preview by default; live move/copy requires explicit confirmation |

The terminal view keeps the same flow but compresses the browser's resizable
three-zone canvas into an adaptive two-pane topology-and-plan deck. It consumes
the existing core plan items directly and does not duplicate scan or transfer
logic.
