import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { getTree, getLog, getBlob, commitChanges, restoreCommit } from "~/functions/git";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Skeleton } from "~/components/ui/skeleton";

export const Route = createFileRoute("/$artifact")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { commit?: string; file?: string } => ({
    commit: search.commit as string | undefined,
    file: search.file as string | undefined,
  }),
  loaderDeps: ({ search }) => ({ commit: search.commit }),
  loader: async ({ params, deps }) => {
    try {
      const [commits, tree] = await Promise.all([
        getLog({ data: { repo: params.artifact } }),
        getTree({ data: { repo: params.artifact, oid: deps.commit } }),
      ]);
      return { commits: commits ?? [], tree: tree ?? [] };
    } catch {
      return { commits: [], tree: [] };
    }
  },
  pendingComponent: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex-1 flex items-center justify-center text-destructive">{error.message}</div>
  ),
  component: ArtifactView,
});

function ArtifactView() {
  const { commits, tree } = Route.useLoaderData();
  const { artifact } = Route.useParams();
  const { commit: selectedCommit, file } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const isHead = !selectedCommit;

  const [head, setHead] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, string>>(() =>
    JSON.parse(localStorage.getItem(`art:${artifact}:working`) || "{}")
  );
  const [fileContent, setFileContent] = useState<string | undefined>();
  const [commitMsg, setCommitMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [langExt, setLangExt] = useState<import("@codemirror/state").Extension[]>([]);

  const [expanded, setExpanded] = useState<Set<string>>(() => expandToFile(file));
  useEffect(() => { if (file) setExpanded((prev) => new Set([...prev, ...expandToFile(file)])); }, [file]);
  const dirty = useMemo(() => new Set(Object.keys(working).filter((p) => working[p] !== head[p])), [working, head]);
  const allPaths = useMemo(() => [...tree, ...Object.keys(working).filter((k) => !tree.includes(k))], [tree, working]);
  const treeNodes = useMemo(() => buildTree(allPaths), [allPaths]);
  const hasLocalChanges = isHead && dirty.size > 0;
  const isNewFile = !!file && file in working && !(file in head);
  const fileLoading = !!file && !isNewFile && fileContent === undefined && !(file in head);

  useEffect(() => { setHead({}); setWorking(JSON.parse(localStorage.getItem(`art:${artifact}:working`) || "{}")); setFileContent(undefined); }, [artifact]);
  useEffect(() => {
    if (!isHead) return;
    const timer = setTimeout(() => localStorage.setItem(`art:${artifact}:working`, JSON.stringify(working)), 500);
    return () => clearTimeout(timer);
  }, [artifact, working, isHead]);

  useEffect(() => {
    setFileContent(undefined);
    if (!file || (file in working && !(file in head))) return;
    let cancelled = false;
    getBlob({ data: { repo: artifact, path: file, oid: selectedCommit } }).then((content) => {
      if (cancelled) return;
      setFileContent(content);
      if (isHead) { setHead((h) => ({ ...h, [file]: content })); setWorking((w) => ({ ...w, [file]: w[file] ?? content })); }
    });
    return () => { cancelled = true; };
  }, [artifact, file, selectedCommit, isHead]);

  useEffect(() => {
    if (!file) { setLangExt([]); return; }
    const desc = LanguageDescription.matchFilename(languages, file);
    if (!desc) { setLangExt([]); return; }
    let cancelled = false;
    desc.load().then((lang) => { if (!cancelled) setLangExt([lang]); });
    return () => { cancelled = true; };
  }, [file]);

  const extensions = useMemo(() => [...langExt], [langExt]);
  const editorValue = isHead && file && working[file] !== undefined ? working[file] : fileContent;

  async function resetAndReload() {
    localStorage.removeItem(`art:${artifact}:working`);
    setCommitMsg(""); setWorking({}); setHead({}); setBusy("");
    await router.invalidate();
  }

  async function handleCommit() {
    if (dirty.size === 0 || !commitMsg.trim()) return;
    setBusy("Committing...");
    await commitChanges({ data: { repo: artifact, message: commitMsg, files: [...dirty].map((p) => ({ path: p, content: working[p] })) } });
    await resetAndReload();
  }

  async function handleRestore(oid: string) {
    setBusy("Restoring...");
    await restoreCommit({ data: { repo: artifact, oid } });
    await resetAndReload();
  }

  return (
    <>
      {/* File tree panel */}
      <div className="w-[220px] border-r flex flex-col shrink-0">
        <div className="flex items-center justify-between p-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Files</span>
          {isHead && <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => {
              const name = prompt("File path (e.g. src/index.ts):");
              if (!name?.trim()) return;
              setWorking((w) => ({ ...w, [name.trim()]: "" }));
              navigate({ search: { file: name.trim() } });
            }}>📄</Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => {
              const name = prompt("Folder path (e.g. src/utils):");
              if (!name?.trim()) return;
              const path = name.trim().replace(/\/$/, "") + "/.gitkeep";
              setWorking((w) => ({ ...w, [path]: "" }));
              setExpanded((prev) => new Set([...prev, name.trim().replace(/\/$/, "")]));
              navigate({ search: { file: path } });
            }}>📁</Button>
          </div>}
        </div>
        <ScrollArea className="flex-1">
          <FileTree nodes={treeNodes} depth={0} selected={file} dirty={isHead ? dirty : undefined} expanded={expanded}
            onSelect={(path) => navigate({ search: { commit: selectedCommit, file: path } })}
            onToggle={(path) => setExpanded((prev) => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; })} />
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex items-center gap-2 p-2 border-b text-sm shrink-0">
          {file && <span className="text-muted-foreground truncate">{file}</span>}
          {!isHead && <span className="text-orange-400 text-xs">Viewing {selectedCommit!.slice(0, 7)} (read-only)</span>}
          {busy && <span className="text-orange-400 ml-auto text-xs">{busy}</span>}
        </div>
        <div className="flex-1 overflow-auto">
          {fileLoading ? <div className="p-8"><Skeleton className="h-4 w-64 mb-2" /><Skeleton className="h-4 w-48 mb-2" /><Skeleton className="h-4 w-56" /></div>
          : file && editorValue !== undefined ? <CodeMirror key={file} value={editorValue} height="100%" theme="dark" extensions={extensions} readOnly={!isHead} editable={isHead} onChange={isHead ? (val) => setWorking((w) => ({ ...w, [file]: val })) : undefined} />
          : <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">{file ? "File not found" : "Select a file"}</div>}
        </div>
      </div>

      {/* History panel */}
      <div className="w-[280px] border-l flex flex-col shrink-0">
        <div className="p-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</span>
        </div>
        <ScrollArea className="flex-1">
          {hasLocalChanges && (
            <div className="p-2 border-b">
              <Input className="h-7 text-xs mb-1.5" placeholder="Commit message" value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCommit()} />
              <Button className="w-full h-7 text-xs" size="sm" onClick={handleCommit} disabled={!commitMsg.trim()}>
                Commit &amp; push {dirty.size} file{dirty.size !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
          {hasLocalChanges && (
            <div className="p-2 border-b border-l-2 border-l-orange-400 bg-accent flex items-center justify-between cursor-pointer" onClick={() => navigate({ search: { file } })}>
              <div>
                <div className="text-orange-400 text-xs font-semibold">Local changes</div>
                <div className="text-muted-foreground text-[11px]">{dirty.size} modified file{dirty.size !== 1 ? "s" : ""}</div>
              </div>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={(e) => {
                e.stopPropagation();
                if (!confirm("Discard all local changes?")) return;
                localStorage.removeItem(`art:${artifact}:working`);
                setWorking({}); setHead({}); setFileContent(undefined);
              }}>✕</Button>
            </div>
          )}
          {commits.map((c, i) => {
            const isLatest = i === 0;
            const isActive = selectedCommit === c.oid || (isHead && i === 0 && !hasLocalChanges);
            return (
              <div key={c.oid} className={`p-2 border-b cursor-pointer ${isActive ? "bg-accent" : "hover:bg-accent/50"}`}
                onClick={() => navigate({ search: { commit: isLatest ? undefined : c.oid, file } })}>
                <div className="text-sm truncate">{isLatest && "HEAD — "}{c.message.split("\n")[0]}</div>
                <div className="text-muted-foreground text-[11px] mt-0.5">{c.oid.slice(0, 7)} · {c.author} · {new Date(c.timestamp * 1000).toLocaleDateString()}</div>
                {!isLatest && selectedCommit === c.oid && (
                  <Button variant="outline" size="sm" className="mt-1 h-6 text-xs" onClick={(e) => { e.stopPropagation(); handleRestore(c.oid); }}>Restore</Button>
                )}
              </div>
            );
          })}
        </ScrollArea>
      </div>
    </>
  );
}

// --- File tree ---

type TreeNode = { name: string; path: string; children: TreeNode[] };

function buildTree(paths: string[]) {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const path of paths.sort()) {
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const partial = parts.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.path === partial);
      if (!child) { child = { name: parts[i], path: partial, children: [] }; current.children.push(child); }
      current = child;
    }
  }
  return root.children;
}

function FileTree({ nodes, depth, selected, dirty, expanded, onSelect, onToggle }: {
  nodes: TreeNode[]; depth: number; selected?: string; dirty?: Set<string>;
  expanded: Set<string>; onSelect: (p: string) => void; onToggle: (p: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isFolder = node.children.length > 0;
        const isOpen = expanded.has(node.path);
        const isDirty = dirty?.has(node.path);
        if (isFolder) {
          return (
            <Collapsible key={node.path} open={isOpen} onOpenChange={() => onToggle(node.path)}>
              <CollapsibleTrigger className={`flex items-center gap-1 w-full py-0.5 px-1 text-[13px] hover:bg-accent/50 cursor-pointer ${isDirty ? "text-orange-400" : ""}`} style={{ paddingLeft: depth * 12 + 8 }}>
                <span className="text-[10px] text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                <span className="text-[12px]">{isOpen ? "📂" : "📁"}</span>
                <span className="truncate">{node.name}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <FileTree nodes={node.children} depth={depth + 1} selected={selected} dirty={dirty} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />
              </CollapsibleContent>
            </Collapsible>
          );
        }
        return (
          <div key={node.path} onClick={() => onSelect(node.path)}
            className={`flex items-center gap-1 py-0.5 px-1 text-[13px] cursor-pointer hover:bg-accent/50 ${node.path === selected ? "bg-accent" : ""} ${isDirty ? "text-orange-400" : ""}`}
            style={{ paddingLeft: depth * 12 + 8 }}>
            <span className="text-[10px] text-muted-foreground invisible">▸</span>
            <span className="text-[12px]">{fileIcon(node.name)}</span>
            <span className="truncate">{isDirty ? "* " : ""}{node.name}</span>
          </div>
        );
      })}
    </>
  );
}

const FILE_ICONS: Record<string, string> = { js: "📜", ts: "📜", tsx: "📜", jsx: "📜", json: "📋", html: "🌐", htm: "🌐", css: "🎨", md: "📝" };
function fileIcon(name: string) { return FILE_ICONS[name.split(".").pop()?.toLowerCase() ?? ""] ?? "📄"; }

function expandToFile(file?: string) {
  if (!file) return new Set<string>();
  const parts = file.split("/");
  const paths = new Set<string>();
  for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join("/"));
  return paths;
}
