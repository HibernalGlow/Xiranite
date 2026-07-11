# Ink UI showcase

Isolated comparison project for [`@inkjs/ui`](https://github.com/vadimdemedes/ink-ui).
It is intentionally outside the root Bun workspace, so it cannot enter the
desktop/browser dependency graph.

```powershell
cd examples/ink-ui-showcase
bun install
bun run start
```

Use Left/Right to switch pages, Tab and arrow keys inside interactive
components, and `q` to exit.

`@inkjs/ui` supplies polished keyboard components and theming. It does not
provide mouse support. The final page separately evaluates
`@zenobius/ink-mouse@1.0.4` (the Ink 6 / React 19 compatible `next` release)
with two adjacent leaf controls.
