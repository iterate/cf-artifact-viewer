/**
 * Server functions for git operations on Cloudflare Artifacts repos.
 *
 * Uses node:fs (Workers native in-memory VFS at /tmp) instead of a custom memfs.
 * https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
 * https://tanstack.com/start/latest/docs/framework/react/server-functions
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import fs from "node:fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

export const listRepos = createServerFn().handler(async () => (env as any).ARTIFACTS.list());

export const createRepo = createServerFn({ method: "POST" })
  .validator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const r = await (env as any).ARTIFACTS.create(data.name);
    return { name: r.name, remote: r.remote };
  });

export const getTree = createServerFn()
  .validator((d: { repo: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const dir = await cloneRepo(data.repo, !!data.oid);
    const paths: string[] = [];
    await git.walk({
      fs, dir, trees: [git.TREE({ ref: data.oid || "HEAD" })],
      map: async (fp, [e]) => { if (fp !== "." && e) paths.push(fp); return fp; },
    });
    return paths.sort();
  });

export const getBlob = createServerFn()
  .validator((d: { repo: string; path: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const dir = await cloneRepo(data.repo);
    if (data.oid) {
      const { blob } = await git.readBlob({ fs, dir, oid: data.oid, filepath: data.path });
      return new TextDecoder().decode(blob);
    }
    return fs.readFileSync(`${dir}/${data.path}`, "utf8");
  });

export const getLog = createServerFn()
  .validator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    const dir = await cloneRepo(data.repo, true);
    return (await git.log({ fs, dir, depth: 50 })).map((c) => ({
      oid: c.oid, message: c.commit.message, author: c.commit.author.name, timestamp: c.commit.author.timestamp,
    }));
  });

export const commitChanges = createServerFn({ method: "POST" })
  .validator((d: { repo: string; message: string; files: { path: string; content: string }[] }) => d)
  .handler(async ({ data }) => {
    const dir = await cloneRepo(data.repo);
    const token = tokenCache.get(data.repo)!;
    for (const f of data.files) {
      fs.writeFileSync(`${dir}/${f.path}`, f.content);
      await git.add({ fs, dir, filepath: f.path });
    }
    await git.commit({ fs, dir, message: data.message, author: { name: "Artifacts", email: "artifacts@iterate.com" } });
    await git.push({ fs, http, dir, remote: "origin", onAuth: () => ({ username: "x", password: token }) });
  });

// O(1) restore via tree reuse — https://isomorphic-git.org/docs/en/commit
export const restoreCommit = createServerFn({ method: "POST" })
  .validator((d: { repo: string; oid: string }) => d)
  .handler(async ({ data }) => {
    const dir = await cloneRepo(data.repo, true);
    const token = tokenCache.get(data.repo)!;
    const { commit: target } = await git.readCommit({ fs, dir, oid: data.oid });
    const headOid = await git.resolveRef({ fs, dir, ref: "HEAD" });
    await git.commit({ fs, dir, message: `Restore to ${data.oid.slice(0, 7)}`, author: { name: "Artifacts", email: "artifacts@iterate.com" }, tree: target.tree, parent: [headOid] });
    await git.push({ fs, http, dir, remote: "origin", onAuth: () => ({ username: "x", password: token }) });
    await git.checkout({ fs, dir, ref: "HEAD", force: true });
  });

// --- Helpers ---

const cloned = new Set<string>();
const deepened = new Set<string>();
const tokenCache = new Map<string, string>();

/** Clone repo to /tmp/<name> if not already cloned. Optionally deepen for history. */
async function cloneRepo(name: string, needsHistory = false) {
  const dir = `/tmp/${name}`;
  const e = env as any;

  if (!cloned.has(name)) {
    const repo = await e.ARTIFACTS.get(name);
    const remote = `https://${e.CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/${e.ARTIFACTS_NAMESPACE}/${name}.git`;
    const { plaintext: token } = await repo.createToken("write", 3600);
    const tokenSecret = token.split("?")[0];
    tokenCache.set(name, tokenSecret);
    await git.clone({ fs, http, dir, url: remote, onAuth: () => ({ username: "x", password: tokenSecret }), singleBranch: true, depth: 1 });
    cloned.add(name);
  }

  if (needsHistory && !deepened.has(name)) {
    const token = tokenCache.get(name)!;
    await git.fetch({ fs, http, dir, depth: 50, relative: true, onAuth: () => ({ username: "x", password: token }) });
    deepened.add(name);
  }

  return dir;
}
