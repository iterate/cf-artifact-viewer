/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouter, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { useState, useEffect } from "react";
import { listRepos, createRepo } from "~/functions/git";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Artifacts" }],
    scripts: [{ src: "https://cdn.tailwindcss.com?plugins=" }],
  }),
  shellComponent: RootShell,
  component: RootLayout,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /><style dangerouslySetInnerHTML={{ __html: "body{margin:0}" }} /></head>
      <body className="bg-[#0d1117] text-[#c9d1d9] font-mono">{children}<Scripts /></body>
    </html>
  );
}

function RootLayout() {
  const [repos, setRepos] = useState<{ name: string }[]>([]);
  useEffect(() => { listRepos().then((d) => setRepos(d?.repos ?? [])).catch(() => {}); }, []);
  const [newName, setNewName] = useState("");
  const router = useRouter();
  const isLoading = useRouterState({ select: (s) => s.isLoading });

  async function handleCreate() {
    if (!newName.trim()) return;
    const name = newName.trim();
    await createRepo({ data: { name } });
    setNewName("");
    const updated = await listRepos();
    setRepos(updated?.repos ?? []);
    router.navigate({ to: "/$artifact", params: { artifact: name }, search: {} });
  }

  return (
    <div className="flex h-screen">
      {isLoading && <div className="fixed top-0 left-0 right-0 h-0.5 bg-blue-500 z-50" />}
      <div className="w-[220px] border-r border-[#30363d] flex flex-col overflow-auto shrink-0">
        <h3 className="px-3 py-2 text-[11px] uppercase tracking-wide text-[#8b949e]">Repos</h3>
        <div className="px-3 py-1 flex gap-1">
          <input className="bg-[#0d1117] text-[#c9d1d9] border border-[#30363d] rounded px-2 py-1 text-[13px] flex-1 min-w-0 outline-none focus:border-blue-500" placeholder="new repo" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          <button className="bg-transparent text-blue-400 border border-[#30363d] rounded px-2 py-0.5 cursor-pointer text-xs hover:bg-[#161b22] shrink-0" onClick={handleCreate}>+</button>
        </div>
        {repos.map((r) => {
          const hasEdits = typeof window !== "undefined" && Object.keys(JSON.parse(localStorage.getItem(`art:${r.name}:working`) || "{}")).length > 0;
          return <Link key={r.name} to="/$artifact" params={{ artifact: r.name }} search={{}} className="block px-3 py-1 text-[13px] text-[#c9d1d9] no-underline hover:bg-[#161b22] truncate" activeProps={{ className: "block px-3 py-1 text-[13px] text-[#c9d1d9] no-underline bg-[#161b22] truncate" }}>{hasEdits ? "* " : ""}{r.name}</Link>;
        })}
      </div>
      <Outlet />
    </div>
  );
}
