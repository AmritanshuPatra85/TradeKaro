# TradeKaro

### Real-Time Multi-Asset Paper Trading Platform

TradeKaro is a full-stack paper-trading platform where users trade **Indian stocks and cryptocurrency with virtual money** using live market data.

Users can place market orders, track live portfolio P&L, build watchlists, view candlestick charts, and compete on real-time leaderboards.

Built from scratch as a full-stack + DevOps project.

<p align="center">
  <a href="https://trade-karo-one.vercel.app">
    <strong>🚀 Live Demo</strong>
  </a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://3-108-151-28.sslip.io/health">
    API
  </a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://github.com/AmritanshuPatra85">
    GitHub
  </a>
</p>

> **Paper trading only.** TradeKaro uses virtual money and does not execute real financial transactions.

---

## What You Can Do

- 📈 Trade **NSE stocks** using live market data
- ₿ Trade **20 cryptocurrency pairs**
- ⚡ Receive **real-time price updates**
- 💰 Place and track market orders
- 📊 Monitor portfolio value and P&L
- ⭐ Create personalized watchlists
- 🕯️ View 1-minute candlestick charts
- 🏆 Compete on a live global leaderboard
- 👥 Create and join private leaderboard rooms
- 🔐 Sign in with Google

---

## Architecture

mermaid
flowchart LR
    B[Breeze API<br/>NSE] --> W[Market Data Worker]
    BN[Binance WebSocket<br/>Crypto] --> W

    W --> R[(Redis)]
    R --> A[Express API<br/>+ Socket.IO]

    A <--> DB[(Supabase<br/>PostgreSQL)]

    U[Next.js<br/>Vercel] <-->|HTTPS / WebSocket| C[Caddy]
    C --> A
How it works

Market data from Breeze and Binance enters a single ingestion pipeline.

The worker normalizes both feeds into a common PriceTick format and publishes updates through Redis.

The API consumes those events and pushes live prices to connected clients through Socket.IO.

When a user places an order, the latest market price is retrieved and the entire portfolio update is executed atomically inside PostgreSQL.

Market Data
     ↓
Worker
     ↓
Redis
     ↓
Express API
     ↓
PostgreSQL
     ↓
Socket.IO
     ↓
Browser
Engineering Highlights
Atomic Order Execution

Orders are executed through a PostgreSQL function:

execute_market_order

Balance validation, holdings updates, order creation, trade creation, and portfolio updates happen within a single database transaction.

This prevents partial state updates when multiple orders are processed concurrently.

Unified Market Data

NSE and cryptocurrency feeds are normalized into the same internal structure:

PriceTick {
  symbol
  market
  price
  timestamp
}

The rest of the system therefore doesn't need to know which provider produced a price.

Real-Time Architecture

Redis handles:

Price caching
Pub/Sub
Leaderboard state

Socket.IO handles:

Live price updates
Portfolio updates
Leaderboard updates

The frontend doesn't rely on continuous HTTP polling for live market data.

Financial Precision

Financial values use high-precision PostgreSQL numeric types such as:

numeric(28,10)

This is particularly important for low-priced cryptocurrency assets.

Production Deployment

The backend is containerized and deployed on AWS EC2.

Caddy
  │
  ├── API
  ├── Worker
  └── Redis

Caddy handles HTTPS and reverse proxying, while the Next.js frontend is deployed independently on Vercel.

Tech Stack

Frontend

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · lightweight-charts

Backend

Node.js 22 · Express · TypeScript · Socket.IO

Data

PostgreSQL · Supabase · Redis 7

Market Data

ICICI Direct Breeze API · Binance WebSocket

Infrastructure

Docker · Docker Compose · Caddy · AWS EC2 · Vercel

Tooling

pnpm Workspaces

Project Structure
TradeKaro/
│
├── apps/
│   ├── api/          # Express API + Socket.IO
│   ├── worker/       # Market-data ingestion
│   └── web/          # Next.js frontend
│
├── packages/
│   └── shared/       # Shared types & schemas
│
├── supabase/         # Database schema & functions
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── Caddyfile
└── pnpm-workspace.yaml
Running Locally
Requirements
Node.js 22
pnpm
Docker
Supabase project
ICICI Direct Breeze API access
Setup
git clone https://github.com/AmritanshuPatra85/TradeKaro.git
cd TradeKaro
pnpm install
Copy-Item .env.example .env
docker compose up -d

Configure the environment variables in .env, then start the services:

pnpm --filter @tradekaro/api dev
pnpm --filter @tradekaro/worker dev
pnpm --filter web dev

Frontend:

http://localhost:3000

API:

http://localhost:4000

Deployment
Backend

Deployed on AWS EC2 using Docker Compose.

Frontend

Deployed on Vercel.

Database

Hosted on Supabase PostgreSQL.

Redis

Runs as part of the production Docker stack.

Current Limitations
Breeze session tokens require daily refresh.
NSE trading follows market hours.
Crypto markets operate 24/7.
Only 1-minute candles are currently persisted.
Production currently runs on a single EC2 instance.


