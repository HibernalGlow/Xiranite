<script lang="ts">
  import { invoke } from "@tauri-apps/api/core"
  import { Child } from "./lib/index.js"

  let count = $state(0)
  const load = () => invoke("open_book", { count })
</script>

<Child />
<button onclick={load}>{count}</button>
<canvas></canvas>
