/**
 * Server functions for git operations on Cloudflare Artifacts repos.
 * https://tanstack.com/start/latest/docs/framework/react/server-functions
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memfs";

const artifacts = () => (env as any).ARTIFACTS;
const AUTHOR = { name: "Artifacts", email: "artifacts@iterate.com" };

export const listRepos = createServerFn().handler(() => artifacts().list());

export const createRepo = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const r = await artifacts().create(data.name);
    return { name: r.name, remote: r.remote };
  });

export const getTree = createServerFn()
  .inputValidator((d: { repo: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, data.oid ? 50 : 1);
    if (!ctx.hasCommits) return [];
    const paths: string[] = [];
    await git.walk({
      ...ctx.git, trees: [git.TREE({ ref: data.oid || "HEAD" })],
      map: async (fp, [e]) => { if (fp !== "." && e) paths.push(fp); return fp; },
    });
    return paths.sort();
  });

export const getBlob = createServerFn()
  .inputValidator((d: { repo: string; path: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo);
    if (!ctx.hasCommits) return "";
    if (data.oid) {
      const { blob } = await git.readBlob({ ...ctx.git, oid: data.oid, filepath: data.path });
      return new TextDecoder().decode(blob);
    }
    return ctx.fs.promises.readFile(`${ctx.dir}/${data.path}`, { encoding: "utf8" }) as Promise<string>;
  });

export const getLog = createServerFn()
  .inputValidator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, 50);
    if (!ctx.hasCommits) return [];
    return (await git.log({ ...ctx.git, depth: 50 })).map((c) => ({
      oid: c.oid, message: c.commit.message, author: c.commit.author.name, timestamp: c.commit.author.timestamp,
    }));
  });

export const commitChanges = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; message: string; files: { path: string; content: string }[] }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo);
    for (const f of data.files) {
      await ctx.fs.promises.writeFile(`${ctx.dir}/${f.path}`, f.content);
      await git.add({ ...ctx.git, filepath: f.path });
    }
    await git.commit({ ...ctx.git, message: data.message, author: AUTHOR });
    await git.push({ ...ctx.git, http, remote: "origin", onAuth: () => ({ username: "x", password: ctx.token }) });
  });

// O(1) restore via tree reuse — https://isomorphic-git.org/docs/en/commit
export const restoreCommit = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; oid: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, 50);
    if (!ctx.hasCommits) throw new Error("Cannot restore an empty repo");
    const { commit: target } = await git.readCommit({ ...ctx.git, oid: data.oid });
    const headOid = await git.resolveRef({ ...ctx.git, ref: "HEAD" });
    await git.commit({ ...ctx.git, message: `Restore to ${data.oid.slice(0, 7)}`, author: AUTHOR, tree: target.tree, parent: [headOid] });
    await git.push({ ...ctx.git, http, remote: "origin", onAuth: () => ({ username: "x", password: ctx.token }) });
    await git.checkout({ ...ctx.git, ref: "HEAD", force: true });
  });

// --- Helpers ---

type RepoCtx = { fs: MemoryFS; dir: string; token: string; git: { fs: any; dir: string }; hasCommits: boolean };
const repoCache = new Map<string, Promise<RepoCtx>>();
const fetchedDepth = new Map<string, number>();

async function ensureRepo(name: string, depth = 1) {
  if (!repoCache.has(name)) repoCache.set(name, initRepo(name));
  const ctx = await repoCache.get(name)!;
  if (depth > 1 && ctx.hasCommits && (fetchedDepth.get(name) ?? 1) < depth) {
    await git.fetch({ ...ctx.git, http, depth, relative: true, onAuth: () => ({ username: "x", password: ctx.token }) });
    fetchedDepth.set(name, depth);
  }
  return ctx;
}

async function initRepo(name: string): Promise<RepoCtx> {
  const repo = await artifacts().get(name);
  const remote = `https://${(env as any).CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/${(env as any).ARTIFACTS_NAMESPACE}/${name}.git`;
  const token = (await repo.createToken("write", 3600)).plaintext.split("?")[0];
  const fs = new MemoryFS();
  const dir = `/${name}`;
  const g = { fs: fs.promises, dir };
  let hasCommits = true;
  try {
    await git.clone({ ...g, http, url: remote, onAuth: () => ({ username: "x", password: token }), singleBranch: true, depth: 1 });
  } catch (err: any) {
    if (!err?.message?.includes("Could not find refs/heads")) throw err;
    hasCommits = false;
    await git.init({ ...g, defaultBranch: "main" });
    await git.addRemote({ ...g, remote: "origin", url: remote });
  }
  return { fs, dir, token, git: g, hasCommits };
}
