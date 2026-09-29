-- Portfolio history is recorded from actual account valuations going forward.
-- No stock/crypto candle data is used to synthesize past portfolio values.
create table if not exists public.portfolio_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  captured_at timestamptz not null,
  total_value numeric(20, 2) not null,
  cash numeric(20, 2) not null,
  holdings_value numeric(20, 2) not null,
  pnl numeric(20, 2) not null,
  base_currency text not null default 'INR' check (base_currency = 'INR'),
  primary key (user_id, captured_at)
);

create index if not exists portfolio_snapshots_user_time_idx
  on public.portfolio_snapshots (user_id, captured_at desc);

alter table public.portfolio_snapshots enable row level security;

drop policy if exists "Users can read their own portfolio snapshots"
  on public.portfolio_snapshots;

create policy "Users can read their own portfolio snapshots"
  on public.portfolio_snapshots
  for select
  to authenticated
  using (auth.uid() = user_id);
