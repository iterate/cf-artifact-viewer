import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$artifact")({
  component: () => {
    const { artifact } = Route.useParams();
    return <div className="flex-1 flex items-center justify-center text-[#8b949e]">Artifact: {artifact}</div>;
  },
});
