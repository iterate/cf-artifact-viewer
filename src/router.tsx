import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPendingMs: 150,
    defaultPendingMinMs: 200,
    defaultStaleTime: 30_000,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register { router: ReturnType<typeof getRouter> }
}
