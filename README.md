# cf-artifact-viewer

Browse, edit, and manage [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repos. Built with [TanStack Start](https://tanstack.com/start) on Cloudflare Workers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iterate/cf-artifact-viewer)

## Features

- Browse Artifacts repos with collapsible file tree + emoji icons
- CodeMirror 6 editor with syntax highlighting (150+ languages)
- Full commit history — browse any commit's state (read-only)
- Restore old commits (O(1) via git tree reuse)
- Create new files and folders, commit & push
- Local changes tracked in localStorage with discard option
- TanStack Start server functions — no REST API layer
- Route loaders with `pendingComponent` (no empty states)

## One-click deploy

Click the button above to deploy to your own Cloudflare account. You need the [Artifacts private beta](https://developers.cloudflare.com/artifacts/) enabled.

After deploying, set your account ID (the Artifacts binding doesn't expose the git remote URL via RPC in server functions):

```bash
npx wrangler secret put CF_ACCOUNT_ID
# paste your Cloudflare account ID
```

## Local development

```bash
npm install
npm run dev
```

## CI deployment

This repo uses [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) — Cloudflare's native CI/CD. Connect the repo in the Cloudflare dashboard:

1. Workers & Pages > select your Worker > Settings > Builds > Connect
2. Select `iterate/cf-artifact-viewer`
3. Build command: `npm run build`
4. Deploy command: `npx wrangler deploy` (default)

Every push to `main` auto-deploys. PRs get build status checks and preview comments automatically — no GitHub Actions needed.

## Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) — full-stack React with server functions
- [CodeMirror 6](https://codemirror.net) via [@uiw/react-codemirror](https://uiwjs.github.io/react-codemirror/)
- [isomorphic-git](https://isomorphic-git.org) — git operations in the Worker
- [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) binding
- [Tailwind CSS v4](https://tailwindcss.com) from CDN

## License

MIT
