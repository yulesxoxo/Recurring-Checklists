# Recurring Checklists

A SvelteKit app for browser-local recurring checklists. Create checklists with sections and tasks, assign reset schedules, check items off, and let completion state clear automatically when each task's schedule rolls over.

## Features

- Create, edit, delete, import, and export checklist definitions.
- Organize checklists into sections with default schedules.
- Override schedules per task when one item needs a different cadence.
- Supported schedules:
  - Daily resets at a configured UTC or local time.
  - Weekly resets on a selected weekday.
  - Biweekly resets from an anchored reset date.
  - Interval resets based on either a fixed anchor or the task's completion time.
- Copy direct links with `?link=<key>` for checklist access.
- Store checklist definitions and completion state in `localStorage`.
- Ship to Cloudflare Workers through the SvelteKit Cloudflare adapter.

## Tech Stack

- Svelte 5 and SvelteKit
- TypeScript
- Vite
- Tailwind CSS and Skeleton UI
- Vitest
- Wrangler / Cloudflare Workers
- pnpm

## Requirements

- Node.js compatible with the versions required by the dependencies.
- pnpm 11.9.0, as recorded in `package.json`.
- Wrangler authentication for deploys.

## Getting Started

Install dependencies:

```sh
pnpm install
```

Start the local dev server:

```sh
pnpm dev
```

Build the app:

```sh
pnpm build
```

Preview the Cloudflare build locally:

```sh
pnpm preview
```

## Scripts

| Command           | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `pnpm dev`        | Start the Vite dev server.                                        |
| `pnpm build`      | Generate Wrangler types and build the app.                        |
| `pnpm preview`    | Build, then run the app with `wrangler dev`.                      |
| `pnpm check`      | Run Wrangler type checks, sync SvelteKit, and run `svelte-check`. |
| `pnpm lint`       | Run Prettier check and ESLint.                                    |
| `pnpm format`     | Format the repo with Prettier.                                    |
| `pnpm eslint:fix` | Apply automatic ESLint fixes.                                     |
| `pnpm test`       | Run unit tests once.                                              |
| `pnpm test:unit`  | Run Vitest.                                                       |
| `pnpm gen`        | Generate Cloudflare Worker types.                                 |
| `pnpm deploy`     | Build and deploy with Wrangler.                                   |

## Data and Sharing

The app is client-side first. It stores state under the `recurring-checklists:v1` localStorage key, so checklists and completions stay in the current browser profile unless exported or manually cleared.

Checklist exports are portable JSON files containing the checklist structure and schedules, but not completion history. Imports validate the portable format and reject duplicate direct-link keys.

Direct links use the `link` query parameter. A checklist can define a human-readable key, or the app falls back to the checklist ID:

```text
/view/?link=NTE
```

## Checklist Templates

Bundled templates live in `src/lib/checklists/templates/` as portable checklist JSON. The manage screen discovers these files at build time and exposes them in the "Add Template" menu.

## Deployment

The project is configured for Cloudflare Workers in `wrangler.jsonc`. To deploy:

```sh
pnpm deploy
```

The build output is generated under `.svelte-kit/cloudflare`, and Wrangler serves assets from that directory.
