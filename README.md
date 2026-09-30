# TradeKaro

A live multi-asset paper trading platform. Trade virtual capital against real market prices (NSE stocks and crypto) and compete on a leaderboard ranked by live portfolio P&L.

**Live demo:** <your-vercel-url>

## Features

- **Live prices:** NSE stocks via the ICICI Direct Breeze API, and 20 crypto pairs via the Binance public WebSocket
- **Paper trading:** market orders (BUY/SELL) filled atomically at the latest cached price, with a flat ₹1,00,000 starting balance for every user
- **Live portfolio:** mark-to-market value and P&L pushed to each user over Socket.IO
- **Live leaderboard:** Redis sorted set ranked by portfolio P&L %, recomputed every second
- **Auth:** Google OAuth or one-click guest mode (Supabase anonymous auth)
- **Watchlist and trade history:** cursor-paginated trades, watchlist capped at 50 symbols
- **Candles:** 1-minute OHLC candles aggregated from the tick stream and stored in Postgres

## Architecture

```
Breeze WS ─┐
           ├─► Worker ─► Redis (price-ticks pub/sub + latest price cache + heartbeat)
Binance WS ┘                │
                            ▼
Next.js (Vercel) ◄──► Express + Socket.IO API ◄──► Supabase Postgres (RPC, RLS)
                            │
                            └─► Redis leaderboard (sorted set)
```

- **Worker** ingests both feeds, normalizes every tick to one `PriceTick` shape, caches the latest price, publishes to Redis, and persists candles.
- **API** verifies Supabase JWTs, executes orders through an atomic Postgres RPC, serves REST endpoints, and runs the Socket.IO real-time layer plus the leaderboard engine.
- **Order execution** is a single Postgres transaction (`execute_market_order`) that locks the portfolio and holdings rows, checks the NSE market-hours gate, balance and quantity, and writes `orders`, `trades`, `holdings` and `portfolios` in one commit. Rejected orders are logged too.
- **Staleness protection:** crypto orders require a price under 15s old. NSE orders require the Breeze feed heartbeat to be under 30s old.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, lightweight-charts |
| API | Node.js, Express, TypeScript, Socket.IO |
| Worker | Node.js, TypeScript, `breezeconnect` SDK, Binance WebSocket |
| Data | Supabase Postgres (RLS + RPC), Redis |
| Auth | Supabase Auth (Google OAuth + anonymous guests) |
| Infra | pnpm workspaces monorepo, Docker Compose, AWS EC2 (backend/worker), Vercel (frontend) |

## Repo structure

```
apps/
  web/       Next.js frontend
  api/       Express + Socket.IO API, leaderboard engine
  worker/    Breeze + Binance ingestion, candle persistence
packages/
  shared/    PriceTick schema, Redis price cache, shared types
```

## Getting started

### Prerequisites

- Node.js 18+ and pnpm
- Docker (for Redis)
- A Supabase project
- ICICI Direct Breeze API credentials (for NSE data)

### Setup

```bash
pnpm install
docker compose up -d redis
```

Create `.env` files (root `.env` for the worker, `apps/api/.env` for the API, `apps/web/.env.local` for the frontend). Typical variables:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
REDIS_URL=redis://localhost:6379
BREEZE_API_KEY="..."        # quote it, unquoted # gets read as a comment
BREEZE_API_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Daily Breeze session

Breeze needs a fresh session token each trading day:

```bash
pnpm --filter @tradekaro/worker set-session <API_Session>
```

### Run

```bash
pnpm dev:worker
pnpm dev:api        # http://localhost:4000
pnpm dev:web        # http://localhost:3000
```

## API overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/orders` | Place a market order (returns `FILLED` or `REJECTED`) |
| GET | `/portfolio` | Cash, holdings, total value, P&L |
| GET | `/trades` | Trade history (`limit`, `before`, `market`, `symbol`) |
| GET | `/watchlist` | List watchlist |
| POST | `/watchlist` | Add a symbol |
| DELETE | `/watchlist/:market/:symbol` | Remove a symbol |
| GET | `/leaderboard` | Top traders plus your rank (`limit`, default 20, max 100) |

**Socket.IO** (JWT in `auth.token`):

- `subscribe` / `unsubscribe` to `price:<market>:<symbol>` rooms, with a snapshot of the last price on subscribe
- Per-user room `user:<userId>` receives portfolio pushes (initial snapshot, then about 1/s when value moves, and immediately after a trade)

Trading rules: NSE orders are whole shares only and only during market hours (9:15 AM to 3:30 PM IST, weekdays). Crypto allows up to 8 decimals and trades 24/7.

## Testing

### Functional tests (all PASS)

| Test | What it covers |
|---|---|
| Order flow (crypto) | BUY, partial SELL, and over-sell (409 `REJECTED`) on BTCUSDT |
| Order flow (NSE) | BUY 1 ITC `FILLED` at ₹266.7, 1,000,000-share BUY `REJECTED` |
| `socket-test.ts` | Socket.IO auth, subscribe/unsubscribe acks, snapshots, price fan-out |
| `leaderboard-test.ts` | Ranking, sync after fills, 16 users |
| `portfolio-push-test.ts` | Per-user portfolio push and isolation between users |
| `loadtest-auth-test.ts` | Load-test auth path (5 users) |

Run a test script with:

```bash
pnpm --filter api exec tsx src/scripts/<script-name>.ts
```

### Load test (500 concurrent users)

Simulated users connect over Socket.IO, subscribe to prices, and place crypto orders every 5 to 15 seconds against a synthetic tick stream.

```bash
pnpm --filter api exec tsx src/scripts/loadtest-sim.ts --users 500
```

| Metric | Result | Target |
|---|---|---|
| Fan-out latency p95 | 129 ms | < 500 ms |
| Order error rate | 0% | < 1% |
| API event-loop lag (worst p99) | 57 ms | < 100 ms |
| Leaderboard recompute (avg / max) | 97 / 128 ms | < 1 s |
| Disconnects | 0 | 0 |

Batching the leaderboard recompute with Redis pipelining cut the cycle from a 1614 ms average to 97 ms at 500 users.

## Roadmap

- Limit orders and an order-matching engine
- Technical indicator overlays (EMA, MACD)
- Competitor and portfolio analytics
- NSE holiday calendar for the market-hours gate

## License

MIT
