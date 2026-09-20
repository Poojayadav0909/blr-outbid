# Startup India — Walking Billboard Spot Auction

A live auction site where brands bid on **13 sponsor spots on a dress** worn at a real event. Winners get their logo printed on the dress, their website listed, and a shoutout on X. Payments are handled end-to-end with [Dodo Payments](https://dodopayments.com), the database is Supabase Postgres, and everything is deployed on Cloudflare Pages.

- **Live site:** https://blr-outbid.pages.dev
- **Stack:** Bun · React 19 · Tailwind CSS v4 · TypeScript · Prisma · Supabase Postgres · Cloudflare Pages (Functions + Hyperdrive) · Dodo Payments · Cloudinary (logo hosting)

---

## How it works

1. Each spot on the dress has a **current bid** (min bid per spot).
2. Brands pick a spot, upload a logo, and pay through Dodo's hosted checkout.
3. On payment success, the spot is marked **sold**, the bid on every other spot is **doubled/bumped**, and the logo is pushed to Cloudinary and shown on the dress preview.
4. Sold-out spots link out to the winner's website.

```
Brand ──► /api/checkout ──► Dodo hosted checkout (card payment)
                              │
                              ├── webhook  /api/webhook/dodo  (HMAC-verified, deduped)
                              └── poll     /api/checkout/:id  (frontend status-poll fallback)
                                                  │
                                                  ▼
                        markOrderPaid + bumpBid + logo settle (Cloudinary)
```

## Repo structure

```
client/
├── functions/            # Cloudflare Pages Functions (production backend)
│   ├── api/
│   │   ├── spots.ts              # GET list of spots + sale state
│   │   ├── checkout.ts           # POST create a Dodo checkout session
│   │   ├── checkout/[sessionId].ts # GET session status
│   │   ├── webhook/dodo.ts       # POST Dodo payment webhook
│   │   └── assets/version.ts     # asset versioning helper
│   └── lib/
│       ├── dodo.ts               # Dodo API (live/test), signature verify, error msgs
│       ├── store.ts              # postgres access (via Hyperdrive, postgres.js)
│       ├── cloudinary.ts         # logo upload/destroy
│       ├── logo.ts               # logo settle pipeline
│       └── env.ts                # environment/bindings types
├── src/
│   ├── App.tsx                   # full frontend (single component)
│   ├── frontend.tsx              # entry
│   ├── index.html                # HTML shell (favicon injected at build)
│   ├── index.ts                  # Bun dev server (full-stack), local/dev backend
│   ├── index.css                 # custom styles
│   ├── data/placements.ts        # ⭐ edit spot positions/prices here
│   ├── lib/                      # local backend: dodo, store (Prisma), cloudinary
│   └── generated/prisma/         # generated Prisma client (do not edit)
├── prisma/
│   ├── schema.prisma             # Spot, Order, WebhookEvent
│   └── seed.ts                   # seeds 13 spots
├── public/                       # favicon.png + dress PNGs (copied to dist)
├── styles/globals.css            # Tailwind v4 entry + theme tokens
├── build.ts                      # Bun build script (HTML + assets + favicon inject)
├── wrangler.toml                 # ⚠️ contains live secrets — gitignored
└── .env                          # ⚠️ local env — gitignored
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- A Supabase Postgres instance
- A [Dodo Payments](https://dodopayments.com) account (test or live)
- A Cloudinary account
- A Cloudflare account + Pages project

### 1. Install dependencies

```sh
bun install
```

### 2. Environment variables

Copy these into `.env` (also mirror them into `wrangler.toml` `[vars]` for the Pages deploy):

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (session-mode pooler, port `5432`, `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`) |
| `PUBLIC_BASE_URL` | Public site URL (e.g. `https://blr-outbid.pages.dev`) |
| `DODO_ENVIRONMENT` | `test` **or** `live`/`production` |
| `DODO_API_KEY` | Dodo API key |
| `DODO_PRODUCT_ID` | Dodo product id for the checkout |
| `DODO_PRODUCT_MIN` | Minimum allowed bid amount (live products below this get `422 REQUEST_AMOUNT_BELOW_MINIMUM`; default `500`) |
| `DODO_WEBHOOK_SECRET` | Dodo webhook signing secret |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

> ⚠️ Never commit `.env` or `wrangler.toml` — both are gitignored because they hold live keys. On Cloudflare, set `CLOUDINARY_API_KEY` as a **project secret** (`wrangler pages secret put CLOUDINARY_API_KEY`) rather than a `[vars]` entry to avoid a "binding already in use" deploy error.

### 3. Database

```sh
# create tables from prisma/schema.prisma
bunx prisma db push
# or generate + migrate:
bunx prisma migrate dev --name init

# seed the 13 spots (id + starting currentBid)
bunx prisma db seed
```

### 4. Local dev (Bun full-stack server, uses Prisma)

```sh
bun dev          # bun --hot src/index.ts  →  http://localhost:3000
```

## Placements (edit spot positions/prices)

All 13 spots live in **`src/data/placements.ts`**. Per spot you can edit:

- `name`, `category`, `price`, `currentBid`, `description`
- `position: { x, y, width, height }` — coordinates in original-PNG pixels (the two dress PNGs are 440×1398 front and 558×1314 back); they scale automatically on screen.

```ts
{ id: "back-mega", name: "Back Mega", category: "Hero placement",
  price: 1300, currentBid: 1300, ...,
  position: { x: 205, y: 205, width: 250, height: 150 } }
```

After editing, redeploy (placements are compiled into the frontend and functions bundles).

## Production build + deploy (Cloudflare Pages + Hyperdrive)

The backend runs as **Cloudflare Pages Functions** (raw postgres.js over a **Hyperdrive** binding — Hyperdrive is required to make pooled Postgres connections cheap and fast on the Workers runtime).

```sh
# create the Hyperdrive binding once, then put its id in wrangler.toml:
npx wrangler hyperdrive create hotspot-supabase \
  --connection-string="postgresql://user:pass@host:5432/postgres"

# set the Cloudinary API key as a Pages secret:
npx wrangler pages secret put CLOUDINARY_API_KEY

# build + deploy:
rm -rf dist
bun run build
npx wrangler pages deploy dist --project-name=blr-outbid --commit-dirty=true --branch main
```

### API routes (production)

| Route | Method | Purpose |
|---|---|---|
| `/api/spots` | GET | All 13 spots with current bid, sold state, winner logo/company/website |
| `/api/checkout` | POST | Create a Dodo checkout session (`{ spotId, amountCents, logo, company, website }`) → `{ checkout_url }` |
| `/api/checkout/:sessionId` | GET | Session status (`pending` / `paid`) — used by the frontend poller |
| `/api/webhook/dodo` | POST | Dodo webhook → verify `Ed25519`/HMAC signature, dedupe via `webhook_events`, settle order |

## Payment details worth knowing

- **Live vs test servers:** Dodo uses `live.dodopayments.com` (live) and `test.dodopayments.com` (test). There is **no** DNS record for `api.dodopayments.com` — pointing at it returns a Cloudflare `530`.
- **Product minimum:** the live product's minimum amount is enforced by `DODO_PRODUCT_MIN`; bids below it return a clean `400` instead of Dodo's `422`.
- **Webhooks:** signature is `v1,<base64>` and is HMAC-SHA256 over `` `${webhookId}.${timestamp}.${rawBody}` `` using `DODO_WEBHOOK_SECRET`. Replays are rejected via the `webhook_events` dedupe table.
- **Settlement fallback:** even if a webhook is missed, the frontend polls `/api/checkout/:sessionId` and settles the order (`webhookId` is recorded as `poll:<session>`).

## Security

- `.env` and `wrangler.toml` are gitignored (they contain live Dodo, Cloudinary, and Postgres secrets).
- Webhook signatures are verified with constant-time comparison; payload is replayed against the raw request body.
- Images are locked down in the UI (no drag / right-click save / long-press copy).

## Scripts

| Command | Description |
|---|---|
| `bun dev` | Local dev server on `:3000` with hot reload |
| `bun start` | Production-mode local Bun server |
| `bun run build` | Build static assets into `dist/` (via `build.ts`) |
| `bunx prisma db push` | Sync Prisma schema to the database |
| `bunx prisma db seed` | Seed the 13 spots |
| `bunx wrangler pages deploy dist --project-name=blr-outbid --branch main` | Deploy to Cloudflare Pages |