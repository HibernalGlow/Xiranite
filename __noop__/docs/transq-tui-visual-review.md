# TransQ OpenTUI visual review

- GUI reference: `output/playwright/transq/transq-reference-review.jpg`
- Terminal capture: `artifacts/cli/transq/translation-queue-board.png`

## Parity

- The Web queue board's four lanes are retained as terminal panels: pending copy, ready, output, and conflict.
- Input roots and the preview/live safety gate remain above the queue, so the queue remains the primary terminal surface.
- The live action uses the shared confirmation overlay before it can copy, move, or remove directories.
- Header reset, exit, help, queue, and node-preference controls are supplied by the shared terminal runtime.
