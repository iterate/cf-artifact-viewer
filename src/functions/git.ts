/**
 * Server functions for git operations on Cloudflare Artifacts repos.
 *
 * These run server-side in the Cloudflare Worker. Module-level caches
 * (repoCache, cloneInFlight, deepened) persist across requests in the same isolate.
 *
 * https://tanstack.com/start/latest/docs/framework/react/server-functions
 * https://isomorphic-git.org/docs/en
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memfs.ts";

// --- Server functions (the public API) ---

export const listRepos = createServerFn().handler(async () => {
  return artifacts().list();
});

export const createRepo = createServerFn({ method: "POST" })
  .validator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const result = await artifacts().create(data.name);
    return { name: result.name, remote: result.remote };
  });

export const getTree = createServerFn()
  .validator((d: { repo: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const { fs, dir } = data.oid ? await ensureDeepened(data.repo) : await ensureCloned(data.repo);
    const paths: string[] = [];
    await git.walk({
      fs: fs.promises, dir, trees: [git.TREE({ ref: data.oid || "HEAD" })],
      map: async (filepath, [entry]) => { if (filepath !== "." && entry) paths.push(filepath); return filepath; },
    });
    return paths.sort();
  });

export const getBlob = createServerFn()
  .validator((d: { repo: string; path: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const { fs, dir } = await ensureCloned(data.repo);
    if (data.oid) {
      const { blob } = await git.readBlob({ fs: fs.promises, dir, oid: data.oid, filepath: data.path });
      return new TextDecoder().decode(blob);
    }
    return fs.promises.readFile(`${dir}/${data.path}`, { encoding: "utf8" }) as Promise<string>;
  });

export const getLog = createServerFn()
  .validator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    const { fs, dir } = await ensureDeepened(data.repo);
    const commits = await git.log({ fs: fs.promises, dir, depth: 50 });
    return commits.map((c) => ({
      oid: c.oid, message: c.commit.message, author: c.commit.author.name, timestamp: c.commit.author.timestamp,
    }));
  });

export const commitChanges = createServerFn({ method: "POST" })
  .validator((d: { repo: string; message: string; files: { path: string; content: string }[] }) => d)
  .handler(async ({ data }) => {
    const { fs, dir, token } = await ensureCloned(data.repo);
    for (const f of data.files) {
      await fs.promises.writeFile(`${dir}/${f.path}`, f.content);
      await git.add({ fs: fs.promises, dir, filepath: f.path });
    }
    await git.commit({ fs: fs.promises, dir, message: data.message, author: { name: "Artifacts", email: "artifacts@iterate.com" } });
    await git.push({ fs: fs.promises, http, dir, remote: "origin", onAuth: () => ({ username: "x", password: token }) });
  });

// O(1) restore via tree reuse — https://isomorphic-git.org/docs/en/commit
export const restoreCommit = createServerFn({ method: "POST" })
  .validator((d: { repo: string; oid: string }) => d)
  .handler(async ({ data }) => {
    const { fs, dir, token } = await ensureDeepened(data.repo);
    const { commit: target } = await git.readCommit({ fs: fs.promises, dir, oid: data.oid });
    const headOid = await git.resolveRef({ fs: fs.promises, dir, ref: "HEAD" });
    await git.commit({ fs: fs.promises, dir, message: `Restore to ${data.oid.slice(0, 7)}`, author: { name: "Artifacts", email: "artifacts@iterate.com" }, tree: target.tree, parent: [headOid] });
    await git.push({ fs: fs.promises, http, dir, remote: "origin", onAuth: () => ({ username: "x", password: token }) });
    await git.checkout({ fs: fs.promises, dir, ref: "HEAD", force: true });
  });

// --- Helpers ---

function artifacts() {
  return (env as unknown as { ARTIFACTS: { list(): Promise<{ repos: { name: string }[] }>; create(name: string): Promise<{ name: string; remote: string; token: string }> } }).ARTIFACTS;
}

const repoCache = new Map<string, { fs: MemoryFS; dir: string; remote: string; token: string }>();
const cloneInFlight = new Map<string, Promise<{ fs: MemoryFS; dir: string; remote: string; token: string }>>();
const deepened = new Set<string>();

async function ensureCloned(name: string) {
  if (repoCache.has(name)) return repoCache.get(name)!;
  if (cloneInFlight.has(name)) return cloneInFlight.get(name)!;
  const promise = (async () => {
    const e = env as unknown as { CF_ACCOUNT_ID: string; ARTIFACTS_NAMESPACE: string; ARTIFACTS: { get(n: string): Promise<{ createToken(s?: string, t?: number): Promise<{ plaintext: string }> }> } };
    const repo = await e.ARTIFACTS.get(name);
    const remote = `https://${e.CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/${e.ARTIFACTS_NAMESPACE}/${name}.git`;
    const { plaintext: token } = await repo.createToken("write", 3600);
    const tokenSecret = token.split("?")[0];
    const fs = new MemoryFS();
    const dir = `/${name}`;
    await git.clone({ fs: fs.promises, http, dir, url: remote, onAuth: () => ({ username: "x", password: tokenSecret }), singleBranch: true, depth: 1 });
    const ctx = { fs, dir, remote, token: tokenSecret };
    repoCache.set(name, ctx);
    cloneInFlight.delete(name);
    return ctx;
  })();
  cloneInFlight.set(name, promise);
  return promise;
}

async function ensureDeepened(name: string) {
  const ctx = await ensureCloned(name);
  if (!deepened.has(name)) {
    await git.fetch({ fs: ctx.fs.promises, http, dir: ctx.dir, depth: 50, relative: true, onAuth: () => ({ username: "x", password: ctx.token }) });
    deepened.add(name);
  }
  return ctx;
}
