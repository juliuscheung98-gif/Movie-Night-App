-- Movie Night: couples, votes and the shared "seen" list.
-- Run once in the Supabase SQL editor (or with `supabase db push`).
-- The title catalog is not stored here; it ships as public/catalog.json.

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

-- A user belongs to at most one couple. Two members per couple, enforced in join_couple().
create table public.members (
  user_id uuid primary key references auth.users on delete cascade,
  couple_id uuid not null references public.couples on delete cascade,
  name text not null default '',
  joined_at timestamptz not null default now()
);
create index on public.members (couple_id);

create table public.votes (
  user_id uuid not null references auth.users on delete cascade,
  couple_id uuid not null references public.couples on delete cascade,
  title_id text not null,
  vote text not null check (vote in ('like', 'dislike')),
  at timestamptz not null default now(),
  primary key (user_id, title_id)
);
create index on public.votes (couple_id);

create table public.seen (
  couple_id uuid not null references public.couples on delete cascade,
  title_id text not null,
  by_user uuid references auth.users on delete set null,
  at timestamptz not null default now(),
  primary key (couple_id, title_id)
);

-- The caller's couple, or null. Security definer so policies can use it without recursing into members' own policy.
create function public.my_couple() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.members where user_id = auth.uid()
$$;

alter table public.couples enable row level security;
alter table public.members enable row level security;
alter table public.votes enable row level security;
alter table public.seen enable row level security;

create policy "see own couple" on public.couples for select using (id = public.my_couple());

create policy "see couple members" on public.members for select using (couple_id = public.my_couple());
create policy "rename self" on public.members for update using (user_id = auth.uid()) with check (couple_id = public.my_couple());

-- Both partners read all of the couple's votes; each writes only their own.
create policy "read couple votes" on public.votes for select using (couple_id = public.my_couple());
create policy "write own votes" on public.votes for insert with check (user_id = auth.uid() and couple_id = public.my_couple());
create policy "change own votes" on public.votes for update using (user_id = auth.uid()) with check (user_id = auth.uid() and couple_id = public.my_couple());
create policy "delete own votes" on public.votes for delete using (user_id = auth.uid());

-- "Seen" is shared: either partner can add or put back a title.
create policy "read couple seen" on public.seen for select using (couple_id = public.my_couple());
create policy "add couple seen" on public.seen for insert with check (couple_id = public.my_couple());
create policy "remove couple seen" on public.seen for delete using (couple_id = public.my_couple());

-- Creating and joining go through functions, so nobody can insert themselves into someone else's couple directly.
create function public.create_couple(display_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text;
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a couple'; end if;
  loop
    -- 6 letters without look-alikes (no I, L, O, 0, 1).
    code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from couples where invite_code = code);
  end loop;
  insert into couples (invite_code) values (code) returning id into cid;
  insert into members (user_id, couple_id, name) values (auth.uid(), cid, coalesce(display_name, ''));
  return code;
end $$;

create function public.join_couple(code text, display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already in a couple'; end if;
  select id into cid from couples where invite_code = upper(trim(code));
  if cid is null then raise exception 'invite code not found'; end if;
  if (select count(*) from members where couple_id = cid) >= 2 then raise exception 'this couple is already full'; end if;
  insert into members (user_id, couple_id, name) values (auth.uid(), cid, coalesce(display_name, ''));
  return cid;
end $$;

revoke execute on function public.create_couple(text) from public, anon;
revoke execute on function public.join_couple(text, text) from public, anon;
grant execute on function public.create_couple(text) to authenticated;
grant execute on function public.join_couple(text, text) to authenticated;

-- Live updates: a partner's likes and "seen" taps show up without reloading.
alter publication supabase_realtime add table public.votes, public.seen, public.members;

-- The nightly job uploads catalog.json here with the service role key; everyone may read it.
insert into storage.buckets (id, name, public) values ('catalog', 'catalog', true) on conflict (id) do nothing;
