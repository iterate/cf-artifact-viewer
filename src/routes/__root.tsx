/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouter, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { listRepos, createRepo } from "~/functions/git";
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "~/components/ui/sidebar";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { TooltipProvider } from "~/components/ui/tooltip";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  ssr: false,
  loader: async () => {
    const data = await listRepos();
    return { repos: (data?.repos ?? []) as { name: string }[] };
  },
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Artifacts" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootLayout,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body className="min-h-screen bg-background font-mono antialiased">
        <TooltipProvider>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const { repos } = Route.useLoaderData();
  const [newName, setNewName] = useState("");
  const router = useRouter();
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  async function handleCreate() {
    if (!newName.trim()) return;
    const name = newName.trim();
    await createRepo({ data: { name } });
    setNewName("");
    await router.invalidate();
    router.navigate({ to: "/$artifact", params: { artifact: name }, search: {} });
  }

  return (
    <SidebarProvider>
      {isLoading && <div className="fixed top-0 left-0 right-0 h-0.5 bg-primary z-50" />}
      <Sidebar>
        <SidebarHeader className="p-3">
          <div className="flex items-center gap-1">
            <Input className="h-7 text-xs" placeholder="new repo" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" onClick={handleCreate}>+</Button>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Repos</SidebarGroupLabel>
            <SidebarMenu>
              {repos.map((r) => {
                const hasEdits = typeof window !== "undefined" && Object.keys(JSON.parse(localStorage.getItem(`art:${r.name}:working`) || "{}")).length > 0;
                return (
                  <SidebarMenuItem key={r.name}>
                    <SidebarMenuButton asChild isActive={false}>
                      <Link to="/$artifact" params={{ artifact: r.name }} search={{}} activeProps={{ className: "bg-sidebar-accent" }}>
                        {hasEdits ? "* " : ""}{r.name}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 p-2 border-b md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Artifacts</span>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
