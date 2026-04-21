import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="flex-1 flex items-center justify-center text-[#8b949e]">
      Select a repo to get started
    </div>
  ),
});
