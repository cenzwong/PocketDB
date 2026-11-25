# Static hosting and GitHub Pages

PocketDB builds to static files in `apps/web/dist`. No PocketDB application
server, database service or runtime configuration endpoint is required. Serve
the whole directory over HTTPS from the site root or a project subpath; keep
the generated `assets/` directory beside `index.html`.

## GitHub Pages

The repository workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
checks out the repository, installs the pinned Node and pnpm versions, runs
`pnpm check`, `pnpm test` and `pnpm build`, uploads `apps/web/dist`, and deploys
that artifact only after a successful push to `main`. Pull requests build and
upload the site artifact without publishing it. The Vite build uses relative
asset URLs so JavaScript, workers, PGlite WASM and data files load from the
project path. Hashed asset filenames provide cache versioning; `index.html`
references the current hashes.

For the first deployment, open **Settings → Pages** for the repository and set
the publishing source to **GitHub Actions**. The workflow's `github-pages`
environment can then publish the uploaded artifact. The Pages URL for this
project is `https://cenzwong.github.io/PocketDB/`. Invitation links use the
current page URL and carry their capability in the URL fragment, so copying an
invitation from the project path retains `/PocketDB/`. The fragment is not sent
to the static host. The app has no path-based client routes and does not need a
server-side SPA rewrite.

## Self-hosting

Build and verify the static artifact from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Publish the contents of `apps/web/dist` to the chosen static host. Preserve the
directory structure and serve JavaScript, worker, WASM and PGlite data assets
with their normal content types. Configure the host/CDN to revalidate
`index.html`; fingerprinted files under `assets/` may be cached as immutable.
For a subpath, serve the output at that path without rewriting asset requests
to the site root.

## Networking requirements and limits

- Local database execution and persistence stay in the user's browser. Static
  hosting only supplies the app and its assets.
- The browser client and host must use the same HTTPS room-signaling provider.
  PocketDB does not operate one. Signaling transports SDP and can observe peer
  IP addresses and connection metadata.
- The current browser console does not expose a STUN/TURN configuration UI or
  operate a relay. Same-network direct WebRTC has been exercised; public
  cross-network reachability, restrictive NATs and relay-only operation remain
  unverified. A deployment cannot remove those networking requirements.
- TURN, when supplied by an integrator, relays peer traffic and can observe
  traffic timing and volume. Use scoped, expiring credentials and account for
  provider terms, quotas and availability.
- GitHub Pages does not provide custom response headers for a project site.
  Current worker-hosted engines are smoke-tested from the generated project
  path; COOP/COEP-dependent or threaded WASM behavior requires a host that can
  configure those headers if a future engine needs them.
- Browser storage is origin-scoped and may be cleared or evicted. Use the
  console's snapshot export for portable backups.

The local artifact probe is `pnpm test:pages`. It serves
the built output under `/PocketDB/`, starts both worker-hosted engines and
checks an invitation link retains the project path. It verifies subpath
packaging locally; only a successful Pages deployment and browser run at the
published URL prove the hosted deployment itself.
