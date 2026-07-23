# Own run plans, not the global ComfyUI queue

Comfygure keeps each Run Plan in its own queue and submits only a bounded window of Prompt Graphs to ComfyUI. It tracks and mutates only its own prompt IDs, pauses by stopping further submission, removes only its own queued prompts during cancellation, and uses the global interrupt endpoint only when the active prompt belongs to the cancelled run.
