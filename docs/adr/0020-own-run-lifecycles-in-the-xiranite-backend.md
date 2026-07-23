---
status: accepted
---

# Own run lifecycles in the Xiranite backend

The Xiranite backend will own Comfygure's Run Coordinator, Target Adapter connections, submission scheduling, progress handling, Run Record transitions, and restart reconciliation. React projections edit projects, issue authenticated commands, and subscribe to backend state; they never directly own a ComfyUI connection or an active run. Closing a card, changing workspace UI, refreshing the frontend, or reloading a desktop webview therefore cannot cancel or orphan work. Backend shutdown still closes transports cleanly, and the next backend instance reconciles persisted non-terminal records according to the no-automatic-resubmission rule.
