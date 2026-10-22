# timelock.dev

Send a message into the future. [timelock.dev](https://timelock.dev) encrypts text so that nobody can read it until a chosen moment, using
[tlock](https://eprint.iacr.org/2023/189) timelock encryption on the [drand](https://drand.love/) quicknet beacon.

This repository is the site and API, deployed as the `tlock-worker` Cloudflare Worker. It started as a fork of Thibault Meunier's Rust
[tlock-worker](https://github.com/thibmeu/tlock-worker) and is now an Astro (TypeScript) app.

- **Website:** encrypts and decrypts in the browser with [tlock-js](https://github.com/drand/tlock-js). Messages never reach the server.
- **JSON API:** `POST /api/encrypt` and `POST /api/decrypt` (server-side). Documentation is at [`/docs`](https://timelock.dev/docs).
- **Original endpoints:** `POST /encrypt/:round` and `POST /decrypt` still accept and return raw bytes, as before.
- **Activity feed:** an anonymous event log (type, timestamps, round) in Cloudflare D1, at [`/feed`](https://timelock.dev/feed).
- **Transparency:** [`/how-it-works`](https://timelock.dev/how-it-works) covers the scheme, the network, what the server sees and the limitations.

Ciphertext is a standard age file, interchangeable with [dee](https://github.com/thibmeu/drand-rs), [tlock](https://github.com/drand/tlock) and
output from the previous Rust worker (`tlock_age` 0.0.5). The test suite includes fixtures from both.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm install                 # also applies patches/ via patch-package
npm run db:migrate:local    # creates the local D1 database in .wrangler/state
npm run dev                 # http://localhost:4327, runs on workerd with local D1
```

`npm run preview` builds for production and serves the real Worker bundle with `wrangler dev` on http://127.0.0.1:4328.

| Command | What it does |
| --- | --- |
| `npm test` | Vitest: time parsing and formatting, round math, all API routes (offline, with a recorded drand beacon and SQLite) |
| `npm run check` | `astro check` plus type-checking the tests |
| `npm run spellcheck` | cspell over sources and docs (`cspell.json` holds the project dictionary) |
| `npm run linkcheck` | linkinator against a running `npm run preview`, including `#fragment` targets |

## Deploy

The Worker name (`tlock-worker`) is unchanged. The `timelock.dev` custom domain is attached in the Cloudflare dashboard, and `wrangler deploy` leaves
it alone. To manage it from config instead, uncomment `routes` in `wrangler.toml`.

One-time setup:

```sh
npx wrangler login
npx wrangler d1 create timelock-events        # copy the printed database_id into wrangler.toml
npm run db:migrate:remote                     # creates the events table
```

Then, for each release:

```sh
npm run deploy                                # astro build && wrangler deploy
```

The app needs no secrets or environment variables. If D1 is missing or its migration hasn't been applied, encryption and decryption keep working and the feed shows as unavailable.

## Layout

```
src/lib/drand.ts      quicknet chain info (pinned), relay client with fallback, round <-> time math
src/lib/tlock.ts      encrypt/decrypt wrappers around tlock-js, ciphertext inspection, typed errors
src/lib/time.ts       duration parsing/formatting, local + UTC formatting, relative times
src/lib/api.ts        request handlers for every endpoint (framework-free, unit-tested)
src/lib/events.ts     D1 queries for the activity feed
src/pages/            Astro pages (prerendered) and thin endpoint wrappers (server-rendered)
src/components/       encrypt form (unlock-time picker), decrypt form, feed
migrations/           D1 schema
patches/              tlock-js patch: Web Crypto randomness for workerd, no beacon logging
```

## Privacy

The feed stores the event type, server timestamp, drand round and unlock time, and nothing else: no plaintext, ciphertext, IP addresses or user
agents. Workers observability logs are deliberately not enabled. The site loads no analytics or third-party scripts.

## License

MIT
