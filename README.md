# cf-artifact-viewer

A minimal browser + editor for [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repos. Built with [TanStack Start](https://tanstack.com/start) on Cloudflare Workers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iterate/cf-artifact-viewer)

## Features

- Browse Artifacts repos, file trees with expand/collapse folders + emoji icons
- CodeMirror 6 editor with syntax highlighting (150+ languages)
- Full commit history — browse any commit's file tree (read-only)
- Restore old commits (O(1) via git tree reuse)
- Edit files at HEAD with local changes tracked in localStorage
- TanStack Start server functions for all git operations
- Route loaders with `pendingComponent` (no empty states)

## Setup

```bash
npm install
```

Set your Cloudflare account ID in `wrangler.jsonc`:

```jsonc
"vars": {
  "CF_ACCOUNT_ID": "your-account-id-here"
}
```

You must have the [Artifacts private beta](https://developers.cloudflare.com/artifacts/) enabled on your account.

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

Or connect the repo to [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) for automatic deploys on push.

## Stack

- [TanStack Start](https://tanstack.com/start) — full-stack React framework with server functions
- [TanStack Router](https://tanstack.com/router) — file-based routing with loaders
- [CodeMirror 6](https://codemirror.net) via [@uiw/react-codemirror](https://uiwjs.github.io/react-codemirror/)
- [isomorphic-git](https://isomorphic-git.org) — git operations in the Worker
- [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) binding
- [Tailwind CSS v4](https://tailwindcss.com) from CDN

## Architecture

All git operations are [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/server-functions) in `src/functions/git.ts`. They run server-side in the Cloudflare Worker and access the Artifacts binding via `import { env } from "cloudflare:workers"`. Route loaders call server functions directly — no REST API layer.

## License

MIT
