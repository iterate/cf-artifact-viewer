/**
 * Server functions for git operations on Cloudflare Artifacts repos.
 * https://tanstack.com/start/latest/docs/framework/react/server-functions
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memfs";

export const listRepos = createServerFn().handler(
  async () => (env as any).ARTIFACTS.list(),
);

export const createRepo = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const r = await (env as any).ARTIFACTS.create(data.name);
    return { name: r.name, remote: r.remote };
  });

export const getTree = createServerFn()
  .inputValidator((d: { repo: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = data.oid
      ? await ensureDeepened(data.repo)
      : await ensureCloned(data.repo);
    if (!ctx) return []; // empty repo
    const paths: string[] = [];
    await git.walk({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      trees: [git.TREE({ ref: data.oid || "HEAD" })],
      map: async (fp, [e]) => {
        if (fp !== "." && e) paths.push(fp);
        return fp;
      },
    });
    return paths.sort();
  });

export const getBlob = createServerFn()
  .inputValidator((d: { repo: string; path: string; oid?: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureCloned(data.repo);
    if (!ctx) return "";
    if (data.oid) {
      const { blob } = await git.readBlob({
        fs: ctx.fs.promises,
        dir: ctx.dir,
        oid: data.oid,
        filepath: data.path,
      });
      return new TextDecoder().decode(blob);
    }
    return ctx.fs.promises.readFile(`${ctx.dir}/${data.path}`, {
      encoding: "utf8",
    }) as Promise<string>;
  });

export const getLog = createServerFn()
  .inputValidator((d: { repo: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureDeepened(data.repo);
    if (!ctx) return []; // empty repo — no commits
    return (await git.log({ fs: ctx.fs.promises, dir: ctx.dir, depth: 50 })).map(
      (c) => ({
        oid: c.oid,
        message: c.commit.message,
        author: c.commit.author.name,
        timestamp: c.commit.author.timestamp,
      }),
    );
  });

export const commitChanges = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      repo: string;
      message: string;
      files: { path: string; content: string }[];
    }) => d,
  )
  .handler(async ({ data }) => {
    // For empty repos, init + set remote instead of clone
    let ctx = await ensureCloned(data.repo);
    if (!ctx) ctx = await initEmptyRepo(data.repo);
    for (const f of data.files) {
      await ctx.fs.promises.writeFile(`${ctx.dir}/${f.path}`, f.content);
      await git.add({ fs: ctx.fs.promises, dir: ctx.dir, filepath: f.path });
    }
    await git.commit({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      message: data.message,
      author: { name: "Artifacts", email: "artifacts@iterate.com" },
    });
    await git.push({
      fs: ctx.fs.promises,
      http,
      dir: ctx.dir,
      remote: "origin",
      onAuth: () => ({ username: "x", password: ctx.token }),
    });
  });

// O(1) restore via tree reuse — https://isomorphic-git.org/docs/en/commit
export const restoreCommit = createServerFn({ method: "POST" })
  .inputValidator((d: { repo: string; oid: string }) => d)
  .handler(async ({ data }) => {
    const ctx = await ensureDeepened(data.repo);
    if (!ctx) throw new Error("Cannot restore an empty repo");
    const { commit: target } = await git.readCommit({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      oid: data.oid,
    });
    const headOid = await git.resolveRef({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      ref: "HEAD",
    });
    await git.commit({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      message: `Restore to ${data.oid.slice(0, 7)}`,
      author: { name: "Artifacts", email: "artifacts@iterate.com" },
      tree: target.tree,
      parent: [headOid],
    });
    await git.push({
      fs: ctx.fs.promises,
      http,
      dir: ctx.dir,
      remote: "origin",
      onAuth: () => ({ username: "x", password: ctx.token }),
    });
    await git.checkout({
      fs: ctx.fs.promises,
      dir: ctx.dir,
      ref: "HEAD",
      force: true,
    });
  });

// --- Helpers ---

type RepoCtx = { fs: MemoryFS; dir: string; remote: string; token: string };
const repoCache = new Map<string, RepoCtx>();
const cloneInFlight = new Map<string, Promise<RepoCtx | null>>();
const deepened = new Set<string>();

/** Clone repo, or return null if it's empty (no commits yet). */
async function ensureCloned(name: string): Promise<RepoCtx | null> {
  if (repoCache.has(name)) return repoCache.get(name)!;
  if (cloneInFlight.has(name)) return cloneInFlight.get(name)!;
  const promise = (async () => {
    const e = env as any;
    const repo = await e.ARTIFACTS.get(name);
    const remote = `https://${e.CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/${e.ARTIFACTS_NAMESPACE}/${name}.git`;
    const { plaintext: token } = await repo.createToken("write", 3600);
    const tokenSecret = token.split("?")[0];
    const fs = new MemoryFS();
    const dir = `/${name}`;
    try {
      await git.clone({
        fs: fs.promises,
        http,
        dir,
        url: remote,
        onAuth: () => ({ username: "x", password: tokenSecret }),
        singleBranch: true,
        depth: 1,
      });
    } catch (err: any) {
      // Empty repo — clone fails with "Could not find refs/heads/master"
      if (err?.message?.includes("Could not find refs/heads")) {
        cloneInFlight.delete(name);
        return null;
      }
      throw err;
    }
    const ctx: RepoCtx = { fs, dir, remote, token: tokenSecret };
    repoCache.set(name, ctx);
    cloneInFlight.delete(name);
    return ctx;
  })();
  cloneInFlight.set(name, promise);
  return promise;
}

/** Init a fresh repo for first commit on an empty Artifacts repo. */
async function initEmptyRepo(name: string): Promise<RepoCtx> {
  const e = env as any;
  const repo = await e.ARTIFACTS.get(name);
  const remote = `https://${e.CF_ACCOUNT_ID}.artifacts.cloudflare.net/git/${e.ARTIFACTS_NAMESPACE}/${name}.git`;
  const { plaintext: token } = await repo.createToken("write", 3600);
  const tokenSecret = token.split("?")[0];
  const fs = new MemoryFS();
  const dir = `/${name}`;
  await git.init({ fs: fs.promises, dir, defaultBranch: "main" });
  await git.addRemote({
    fs: fs.promises,
    dir,
    remote: "origin",
    url: remote,
  });
  const ctx: RepoCtx = { fs, dir, remote, token: tokenSecret };
  repoCache.set(name, ctx);
  return ctx;
}

async function ensureDeepened(name: string): Promise<RepoCtx | null> {
  const ctx = await ensureCloned(name);
  if (!ctx) return null;
  if (!deepened.has(name)) {
    await git.fetch({
      fs: ctx.fs.promises,
      http,
      dir: ctx.dir,
      depth: 50,
      relative: true,
      onAuth: () => ({ username: "x", password: ctx.token }),
    });
    deepened.add(name);
  }
  return ctx;
}
