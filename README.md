# cf-artifact-viewer

A minimal browser + editor for [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repos. Browse files, edit at HEAD, view commit history, and restore old commits.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iterate/cf-artifact-viewer)

## Features

- Browse Artifacts repos, file trees with expand/collapse folders
- CodeMirror 6 editor with syntax highlighting (150+ languages)
- Full commit history — browse any commit's file tree (read-only)
- Restore old commits (O(1) via git tree reuse, not file-by-file)
- Edit files at HEAD with local changes tracked in localStorage
- TanStack Router with loaders + pendingComponent (no empty states)
- Tailwind v4 from CDN, zero build-time CSS config

## Setup

```bash
npm install
```

Set your Cloudflare account ID in `wrangler.jsonc`:

```jsonc
"vars": {
  "CF_ACCOUNT_ID": "your-account-id-here",
  "ARTIFACTS_NAMESPACE": "default"
}
```

You must have the Artifacts private beta enabled on your account.

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

Or connect the repo to [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) for automatic deploys on push.

## Authentication (optional)

To protect the API with HTTP basic auth, set a secret:

```bash
npx wrangler secret put BASIC_AUTH_PASSWORD
```

When set, all `/api/*` requests require basic auth. The username can be anything; only the password is checked. The SPA itself is still served publicly — auth only gates API calls (repo listing, file reads, commits, restores).

To use from `curl`:

```bash
curl -u "x:your-password" https://your-worker.workers.dev/api/repos
```

In the browser, the standard basic auth dialog will appear on first API call.

## Stack

- [Vite](https://vite.dev) + [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/frameworks/framework-guides/vite/)
- [React 19](https://react.dev) + [TanStack Router](https://tanstack.com/router)
- [CodeMirror 6](https://codemirror.net) via [@uiw/react-codemirror](https://uiwjs.github.io/react-codemirror/)
- [isomorphic-git](https://isomorphic-git.org) for git operations in the Worker
- [Tailwind CSS v4](https://tailwindcss.com) from CDN
- [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) binding

## License

MIT
