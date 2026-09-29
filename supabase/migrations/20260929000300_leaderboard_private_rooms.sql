create table if not exists public.leaderboard_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  name text not null check (char_length(name) between 1 and 40),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.leaderboard_room_members (
  room_id uuid not null references public.leaderboard_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists leaderboard_room_members_user_idx
  on public.leaderboard_room_members (user_id, joined_at desc);

alter table public.leaderboard_rooms enable row level security;
alter table public.leaderboard_room_members enable row level security;

-- No client table policies: the API service role checks room membership before
-- returning codes or rankings, keeping room membership private by default.
