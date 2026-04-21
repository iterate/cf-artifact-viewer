import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Select a repo to get started
    </div>
  ),
});
