# Market Intelligence Frontend (Next.js)

This is a Next.js App Router frontend for the Multi-Agent Market Intelligence Analysis System. It features React Query, Tailwind, shadcn/ui, and Recharts. It includes automatic Kite token health monitoring every 60s.

## Quick Start

1. Set `NEXT_PUBLIC_API_BASE_URL` in `.env.local` (e.g., `http://localhost:8000`).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```

## Key Features

- Global Kite health warning tile (auto-refresh every 60s)
- Dashboard with market brief, OHLCV chart, sentiment, risk overview
- Modular API client and typed React Query hooks
- Beautiful fintech UI using Tailwind + shadcn/ui + Recharts
