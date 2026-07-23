---
status: accepted
---

# Verify in stages with non-destructive live preflight

Comfygure delivery proceeds through independently testable vertical slices. The first slice establishes the Program contracts, deterministic compilation primitives, fixed heavy-node projection, Target Adapter preflight, and serial automated tests. The second slice starts with explicit single-job submission through the existing backend Node Operation and recorded node-run history, then adds the persisted Run Coordinator, progress reconciliation, Result References, and recovery. The third slice adds template binding import and the optional diagnostic Canvas Export. Later Recipes expand model and generation coverage without weakening the first ANIMA INT8 path.

Automated validation includes deterministic compiler unit tests, schema and API-boundary contract tests, and host-node registration tests. When the configured local ComfyUI target is available, live integration begins with non-destructive target inspection and `/object_info` compatibility preflight. Comfygure does not submit a `/prompt` task merely to probe connectivity because it may consume compute and create output. Real prompt submission occurs only through the explicit user-facing Run command, which performs a fresh compatibility preflight before submission.
