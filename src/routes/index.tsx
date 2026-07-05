import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "../workspace/store";
import { ThemeProvider } from "../workspace/theme";
import { Workspace } from "../workspace/Workspace";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <ThemeProvider>
      <WorkspaceProvider
        seed={[
          { kind: "kanban", title: "KANBAN BOARD" },
          { kind: "terminal", title: "TERMINAL" },
          { kind: "mixer", title: "ACID MIXER" },
          { kind: "clock", title: "CLOCK" },
          { kind: "counter", title: "COUNTER" },
          { kind: "calc", title: "CALCULATOR" },
          { kind: "tasks", title: "TASKS" },
          { kind: "notes", title: "SCRATCH" },
        ]}
      >
        <Workspace />
      </WorkspaceProvider>
    </ThemeProvider>
  );
}

