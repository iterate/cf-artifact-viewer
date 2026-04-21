/**
 * Server functions for git operations on Cloudflare Artifacts repos.
 * https://tanstack.com/start/latest/docs/framework/react/server-functions
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memfs";

const AUTHOR = { name: "Artifacts", email: "artifacts@iterate.com" };
const MAX_CACHED_REPOS = 10;

export const listRepos = createServerFn({ method: "GET" }).handler(
  () => env.ARTIFACTS.list(),
);

export const createRepo = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const r = await env.ARTIFACTS.create(data.name);
    return { name: r.name, remote: r.remote };
  });

export const getTree = createServerFn({ method: "GET" })
  .inputValidator((d: { repo: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, data.oid ? 50 : 1);
    if (!ctx.hasCommits) return [];
    // https://isomorphic-git.org/docs/en/listFiles
    return git.listFiles({ ...ctx.gitOpts, ref: data.oid || "HEAD" });
  });

export const getBlob = createServerFn({ method: "GET" })
  .inputValidator((d: { repo: string; path: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo);
    if (!ctx.hasCommits) return "";
    if (data.oid) {
      const { blob } = await git.readBlob({ ...ctx.gitOpts, oid: data.oid, filepath: data.path });
      return new TextDecoder().decode(blob);
    }
    return ctx.fs.promises.readFile(`${ctx.dir}/${data.path}`, { encoding: "utf8" }) as Promise<string>;
  });

export const getLog = createServerFn({ method: "GET" })
  .inputValidator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, 50);
    if (!ctx.hasCommits) return [];
    return (await git.log({ ...ctx.gitOpts, depth: 50 })).map((c) => ({
      oid: c.oid, message: c.commit.message, author: c.commit.author.name, timestamp: c.commit.author.timestamp,
    }));
  });

export const commitChanges = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; message: string; files: { path: string; content: string }[] }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo);
    for (const f of data.files) {
      await ctx.fs.promises.writeFile(`${ctx.dir}/${f.path}`, f.content);
      await git.add({ ...ctx.gitOpts, filepath: f.path });
    }
    await git.commit({ ...ctx.gitOpts, message: data.message, author: AUTHOR });
    await git.push({ ...ctx.gitOpts, http, remote: "origin", onAuth: () => ({ username: "x", password: ctx.token }) });
  });

export const restoreCommit = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; oid: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureRepo(data.repo, 50);
    if (!ctx.hasCommits) throw new Error("Cannot restore an empty repo");
    const { commit: target } = await git.readCommit({ ...ctx.gitOpts, oid: data.oid });
    const headOid = await git.resolveRef({ ...ctx.gitOpts, ref: "HEAD" });
    // O(1) restore: reuse target's tree object — https://isomorphic-git.org/docs/en/commit
    await git.commit({ ...ctx.gitOpts, message: `Restore to ${data.oid.slice(0, 7)}`, author: AUTHOR, tree: target.tree, parent: [headOid] });
    await git.push({ ...ctx.gitOpts, http, remote: "origin", onAuth: () => ({ username: "x", password: ctx.token }) });
  });

// --- Helpers ---

const repoCache = new Map<string, Promise<Awaited<ReturnType<typeof initRepo>>>>();
// Tracks the largest relative depth fetched per repo — only re-fetches when a larger depth is requested
const fetchedDepth = new Map<string, number>();

async function ensureRepo(name: string, depth = 1) {
  if (!repoCache.has(name)) {
    const p = initRepo(name);
    repoCache.set(name, p);
    p.catch(() => repoCache.delete(name)); // evict failed clones so they can be retried
    // LRU eviction — keep at most MAX_CACHED_REPOS
    if (repoCache.size > MAX_CACHED_REPOS) {
      const oldest = repoCache.keys().next().value!;
      repoCache.delete(oldest);
      fetchedDepth.delete(oldest);
    }
  }
  const ctx = await repoCache.get(name)!;
  if (depth > 1 && ctx.hasCommits && (fetchedDepth.get(name) ?? 1) < depth) {
    await git.fetch({ ...ctx.gitOpts, http, depth, relative: true, onAuth: () => ({ username: "x", password: ctx.token }) });
    fetchedDepth.set(name, depth);
  }
  return ctx;
}

async function initRepo(name: string) {
  const repo = await env.ARTIFACTS.get(name);
  const remote = `https://${(env as any).CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/default/${name}.git`;
  const token = (await repo.createToken("write", 3600)).plaintext;
  const fs = new MemoryFS();
  const dir = `/${name}`;
  const gitOpts = { fs: fs.promises, dir };
  let hasCommits = true;
  try {
    await git.clone({ ...gitOpts, http, url: remote, onAuth: () => ({ username: "x", password: token }), singleBranch: true, depth: 1 });
  } catch (err: any) {
    // Empty repo — clone fails because there are no refs yet
    if (!/Could not find|HttpError|empty/.test(err?.message ?? "")) throw err;
    hasCommits = false;
    await git.init({ ...gitOpts, defaultBranch: "main" });
    await git.addRemote({ ...gitOpts, remote: "origin", url: remote });
  }
  return { fs, dir, token, gitOpts, hasCommits };
}
