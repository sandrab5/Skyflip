create table if not exists bookings (
  ref text primary key,
  email text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Row Level Security is enabled but no public policies are added on
-- purpose: only the service role key (used exclusively inside the Edge
-- Functions, never exposed to the browser) can read or write this table.
alter table bookings enable row level security;
