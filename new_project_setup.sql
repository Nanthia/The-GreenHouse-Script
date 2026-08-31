-- ===========================================================================
-- The Green House — full setup for a FRESH Supabase project
-- ===========================================================================
-- Run this once, in the SQL Editor of a brand new project. It creates every
-- table the userscript needs, the integrity rules, and row-level security,
-- in one pass. Safe to re-run (idempotent).
--
-- DIFFERENCES FROM THE ORIGINAL supabase_schema.sql:
--   * faction_config has NO torn_api_key / ffs_api_key columns. Those never
--     needed to live in a client-readable table — each client keeps its own
--     key locally. This is the main reason to start fresh.
--   * RLS is on from the start, rather than "disabled for now".
--   * Added integrity the app was relying on luck for: NOT NULL defaults on
--     created_at (the claim queue orders by it), a guard against the same
--     person double-claiming a target, and an updated_at trigger.
--
-- ONE THING TO EDIT: your faction ID, in section 1 below. It's defined once
-- as a function so you don't have to find-and-replace it through the policies.
--
-- AFTER RUNNING IT, see section 9 for the three app-side follow-ups.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. YOUR FACTION ID  <<< EDIT THIS ONE LINE >>>
-- ---------------------------------------------------------------------------
-- Policies can't take parameters, so this immutable function stands in for a
-- constant. Change 12345 to your faction ID and everything below follows.

create or replace function tgh_faction_id()
returns bigint
language sql
immutable
parallel safe
as $$ select 12345::bigint $$;

comment on function tgh_faction_id() is
  'The faction this project belongs to. Referenced by the hit_claims insert policy.';


-- ---------------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------------

-- 2a. Hit claims — the target queue. This is the hot table.
create table if not exists hit_claims (
  id               uuid primary key default gen_random_uuid(),
  faction_id       bigint      not null,
  target_player_id bigint      not null,
  target_name      text,
  claimer_torn_id  bigint      not null,
  claimer_name     text        not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  released_at      timestamptz,

  constraint hit_claims_ids_positive
    check (target_player_id > 0 and claimer_torn_id > 0),
  constraint hit_claims_expiry_after_creation
    check (expires_at > created_at),
  constraint hit_claims_name_sane
    check (char_length(claimer_name) between 1 and 40)
);

-- 2b. Strike teams
create table if not exists strike_teams (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  leader_id            text not null,
  leader_name          text not null,
  description          text,
  status               text not null default 'planning'
    check (status in ('planning','recruiting','ready','countdown','in_progress','completed','cancelled')),
  start_time           timestamptz,
  notes                text,
  current_target_order int default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint strike_teams_name_sane
    check (char_length(name) between 1 and 80),
  constraint strike_teams_description_sane
    check (description is null or char_length(description) <= 500)
);

create table if not exists strike_team_members (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references strike_teams(id) on delete cascade,
  member_id     text not null,
  member_name   text not null,
  position      int  not null default 0,
  role          text not null default 'member'
    check (role in ('leader','co_leader','member')),
  ready_status  text not null default 'not_ready'
    check (ready_status in ('ready','not_ready','unavailable')),
  invite_status text not null default 'pending'
    check (invite_status in ('pending','accepted','declined')),
  joined_at     timestamptz not null default now(),

  constraint strike_team_members_name_sane
    check (char_length(member_name) between 1 and 40),
  -- the same player shouldn't be on one team twice
  constraint strike_team_members_unique_per_team
    unique (team_id, member_id)
);

create table if not exists strike_team_targets (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references strike_teams(id) on delete cascade,
  target_id      text not null,
  target_name    text not null,
  target_level   int,
  order_position int  not null default 0,
  completed      boolean not null default false,
  notes          text,
  added_at       timestamptz not null default now(),

  constraint strike_team_targets_name_sane
    check (char_length(target_name) between 1 and 40),
  constraint strike_team_targets_unique_per_team
    unique (team_id, target_id)
);

-- 2c. Shared faction config — NOTE: no API key columns, deliberately.
create table if not exists faction_config (
  id                     uuid primary key default '00000000-0000-0000-0000-000000000000',
  my_faction_id          text,
  my_faction_name        text,
  enemy_faction_id       text,
  enemy_faction_name     text,
  ffs_is_premium         boolean default false,
  ffs_premium_expires_at bigint,
  war_prep_last_polled   timestamptz,
  claim_ttl_seconds      integer default 120
    check (claim_ttl_seconds between 10 and 3600),
  updated_at             timestamptz not null default now()
);

-- Seed the singleton row the app expects.
insert into faction_config (id) values ('00000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

-- 2d. Webapp-only tables. Harmless to create; left closed to clients in
--     section 6 unless you re-open them there.
create table if not exists user_preferences (
  username   text primary key,
  theme      text not null default 'dark' check (theme in ('dark','light')),
  updated_at timestamptz not null default now()
);

create table if not exists member_activity_snapshots (
  id              uuid primary key default gen_random_uuid(),
  member_id       text not null,
  member_name     text not null,
  xan_taken       bigint default 0,
  refills         bigint default 0,
  recorded_at     timestamptz not null default now(),
  poll_session_id uuid
);


-- ---------------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------------
-- The userscript's main claim query filters faction_id + released_at is null
-- + expires_at > now(), then orders by created_at. This covers it.
create index if not exists hit_claims_live_idx
  on hit_claims (faction_id, expires_at desc, created_at)
  where released_at is null;

create index if not exists hit_claims_target_idx
  on hit_claims (faction_id, target_player_id, expires_at desc);

create index if not exists strike_team_members_team_idx on strike_team_members (team_id, position);
create index if not exists strike_team_targets_team_idx on strike_team_targets (team_id, order_position);
create index if not exists strike_teams_status_idx      on strike_teams (status, created_at desc);
create index if not exists member_activity_member_idx   on member_activity_snapshots (member_id, recorded_at desc);


-- ---------------------------------------------------------------------------
-- 4. INTEGRITY TRIGGERS
-- ---------------------------------------------------------------------------

-- 4a. Keep strike_teams.updated_at honest even if a client forgets to set it.
create or replace function tgh_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists strike_teams_touch_updated_at on strike_teams;
create trigger strike_teams_touch_updated_at
  before update on strike_teams
  for each row execute function tgh_touch_updated_at();

-- 4b. Stop one person holding two live claims on the same target.
--     This can't be a unique index, because the condition involves now()
--     (index predicates must be immutable), so it's a trigger.
create or replace function tgh_block_duplicate_claim()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from hit_claims c
     where c.target_player_id = new.target_player_id
       and c.claimer_torn_id  = new.claimer_torn_id
       and c.released_at is null
       and c.expires_at  > now()
  ) then
    raise exception 'You already hold a live claim on target %', new.target_player_id
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

drop trigger if exists hit_claims_no_duplicate_claims on hit_claims;
create trigger hit_claims_no_duplicate_claims
  before insert on hit_claims
  for each row execute function tgh_block_duplicate_claim();

-- 4c. Housekeeping. Clients can't delete (no grant), so run this yourself
--     from the dashboard now and then, or schedule it with pg_cron:
--       select cron.schedule('prune-claims','0 4 * * *',
--                            $$select tgh_prune_hit_claims()$$);
create or replace function tgh_prune_hit_claims(older_than interval default '30 days')
returns bigint language plpgsql as $$
declare removed bigint;
begin
  delete from hit_claims where expires_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end $$;

-- Deliberately NOT security definer: this must not become a delete path for
-- the anon key. Run it as the dashboard/postgres user.


-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY — the userscript's tables
-- ---------------------------------------------------------------------------
-- Start from zero privileges on every table, then grant back precisely what
-- the client needs. Explicit, rather than relying on Supabase's defaults.

alter table hit_claims           enable row level security;
alter table strike_teams         enable row level security;
alter table strike_team_members  enable row level security;
alter table strike_team_targets  enable row level security;
alter table faction_config       enable row level security;
alter table user_preferences     enable row level security;
alter table member_activity_snapshots enable row level security;

revoke all on hit_claims, strike_teams, strike_team_members,
              strike_team_targets, faction_config, user_preferences,
              member_activity_snapshots
  from anon, authenticated;

-- 5a. hit_claims -----------------------------------------------------------
drop policy if exists "claims readable"  on hit_claims;
drop policy if exists "claims insert"    on hit_claims;
drop policy if exists "claims release"   on hit_claims;

-- Everyone needs to see the queue.
create policy "claims readable"
  on hit_claims for select to anon
  using (true);

-- Writes must be for THIS faction, structurally sane, and short-lived.
-- The TTL ceiling is what stops someone parking a claim until 2099.
create policy "claims insert"
  on hit_claims for insert to anon
  with check (
        faction_id       = tgh_faction_id()
    and target_player_id > 0
    and claimer_torn_id  > 0
    and char_length(claimer_name) between 1 and 40
    and expires_at >  now()
    and expires_at <= now() + interval '1 hour'
    and released_at is null
  );

-- Releasing is the only update, and only on a claim that's still live.
create policy "claims release"
  on hit_claims for update to anon
  using      (released_at is null)
  with check (released_at is not null);

grant select on hit_claims to anon;

-- IMPORTANT: created_at is deliberately NOT insertable. The queue is ordered
-- by it, so a client that could set it could backdate a claim and jump to
-- position #1 ahead of everyone. Leaving it to the column default also means
-- the database clock decides queue order, so a member whose PC clock is wrong
-- doesn't get a wrong position. The userscript omits it for this reason.
grant insert (faction_id, target_player_id, target_name,
              claimer_torn_id, claimer_name, expires_at) on hit_claims to anon;

-- Column-level grant: released_at is the ONLY updatable column, so nobody can
-- rewrite claimer_name to steal a claim. A policy can't express this.
grant update (released_at) on hit_claims to anon;

-- No delete grant and no delete policy: claims are never deletable by a
-- client. Expiry and release are the only exits.

-- 5b. strike_teams ---------------------------------------------------------
-- These need full CRUD (creating and deleting teams are features), so the
-- policies are permissive with sanity checks. This is the weak spot of an
-- anon-only setup: someone holding the key can delete a team. Closing that
-- needs per-user identity (the Edge Function token exchange).

drop policy if exists "teams readable" on strike_teams;
drop policy if exists "teams insert"   on strike_teams;
drop policy if exists "teams update"   on strike_teams;
drop policy if exists "teams delete"   on strike_teams;

create policy "teams readable" on strike_teams for select to anon using (true);
create policy "teams insert"   on strike_teams for insert to anon
  with check (char_length(name) between 1 and 80 and leader_id is not null);
create policy "teams update"   on strike_teams for update to anon
  using (true) with check (char_length(name) between 1 and 80);
create policy "teams delete"   on strike_teams for delete to anon using (true);

grant select, delete on strike_teams to anon;
-- created_at left to its default for the same reason as hit_claims: the team
-- list is ordered by it.
grant insert (name, leader_id, leader_name, description, status,
              start_time, notes, current_target_order) on strike_teams to anon;
grant update (name, description, status, start_time, notes,
              current_target_order, updated_at) on strike_teams to anon;

drop policy if exists "members readable" on strike_team_members;
drop policy if exists "members insert"   on strike_team_members;
drop policy if exists "members update"   on strike_team_members;
drop policy if exists "members delete"   on strike_team_members;

create policy "members readable" on strike_team_members for select to anon using (true);
create policy "members insert"   on strike_team_members for insert to anon
  with check (member_id is not null and char_length(member_name) between 1 and 40);
create policy "members update"   on strike_team_members for update to anon
  using (true) with check (true);
create policy "members delete"   on strike_team_members for delete to anon using (true);

grant select, insert, delete on strike_team_members to anon;
grant update (ready_status, invite_status, position, role) on strike_team_members to anon;

drop policy if exists "targets readable" on strike_team_targets;
drop policy if exists "targets insert"   on strike_team_targets;
drop policy if exists "targets update"   on strike_team_targets;
drop policy if exists "targets delete"   on strike_team_targets;

create policy "targets readable" on strike_team_targets for select to anon using (true);
create policy "targets insert"   on strike_team_targets for insert to anon
  with check (target_id is not null and char_length(target_name) between 1 and 40);
create policy "targets update"   on strike_team_targets for update to anon
  using (true) with check (true);
create policy "targets delete"   on strike_team_targets for delete to anon using (true);

grant select, insert, delete on strike_team_targets to anon;
grant update (completed, order_position, notes, target_name, target_level)
  on strike_team_targets to anon;


-- ---------------------------------------------------------------------------
-- 6. faction_config and the webapp-only tables
-- ---------------------------------------------------------------------------
-- The userscript doesn't need faction_config at all: every client detects the
-- war from its own API key (SYNC_WAR_TO_SUPABASE is false by default). So it
-- stays read-only here — enough for the webapp to display, not enough for
-- anyone to vandalise your enemy faction ID.
--
-- There are no API key columns in this table now, so reading it is harmless.

drop policy if exists "config readable" on faction_config;
create policy "config readable" on faction_config for select to anon using (true);
grant select on faction_config to anon;

-- >>> Only if you repoint the React webapp at this project AND want its
-- >>> Config page to keep writing the shared enemy faction, uncomment:
--
-- drop policy if exists "config update" on faction_config;
-- create policy "config update" on faction_config for update to anon
--   using (true) with check (true);
-- grant update (my_faction_id, my_faction_name, enemy_faction_id,
--               enemy_faction_name, claim_ttl_seconds, updated_at)
--   on faction_config to anon;

-- >>> Only if you repoint the webapp and use its theme sync / Activity
-- >>> Center. member_activity_snapshots is per-member xanax and refill
-- >>> counts — faction intel you may not want readable by anyone holding
-- >>> the key. Left closed by default.
--
-- create policy "prefs readable" on user_preferences for select to anon using (true);
-- create policy "prefs insert"   on user_preferences for insert to anon with check (true);
-- create policy "prefs update"   on user_preferences for update to anon using (true) with check (true);
-- grant select, insert, update on user_preferences to anon;
--
-- create policy "snapshots readable" on member_activity_snapshots for select to anon using (true);
-- create policy "snapshots insert"   on member_activity_snapshots for insert to anon with check (true);
-- grant select, insert on member_activity_snapshots to anon;


-- ---------------------------------------------------------------------------
-- 7. REALTIME (only needed if you repoint the React webapp here)
-- ---------------------------------------------------------------------------
-- The webapp subscribes via postgres_changes; the userscript polls instead
-- and needs none of this. Tables must be in the publication to emit events.
-- Harmless to run either way.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table hit_claims;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table strike_teams;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table strike_team_members;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table strike_team_targets;
    exception when duplicate_object then null; end;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 8. VERIFY
-- ---------------------------------------------------------------------------

-- Every table should be rls_enabled = true:
select relname as table_name, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relname;

-- Exactly what the anon key can do, column by column. Check that no row here
-- mentions a key column, and that hit_claims UPDATE is released_at only:
select table_name, privilege_type, string_agg(column_name, ', ' order by column_name) as columns
  from information_schema.column_privileges
 where grantee = 'anon' and table_schema = 'public'
 group by table_name, privilege_type
 order by table_name, privilege_type;

-- The policies themselves:
select tablename, policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'public'
 order by tablename, cmd;

-- Confirm your faction ID took:
select tgh_faction_id() as faction_id;


-- ---------------------------------------------------------------------------
-- 9. SMOKE TEST — prove the denials actually bite
-- ---------------------------------------------------------------------------
-- Run this block as-is. It should print 'ALL CHECKS PASSED'. If any check
-- fails to be denied, it raises instead.

do $$
declare ok boolean;
begin
  set local role anon;

  -- must be DENIED: claiming on behalf of another faction
  begin
    insert into hit_claims (faction_id, target_player_id, claimer_torn_id, claimer_name, expires_at)
    values (999999, 1, 1, 'x', now() + interval '5 minutes');
    raise exception 'FAIL: wrong-faction insert was allowed';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- must be DENIED: absurd TTL
  begin
    insert into hit_claims (faction_id, target_player_id, claimer_torn_id, claimer_name, expires_at)
    values (tgh_faction_id(), 1, 1, 'x', now() + interval '10 years');
    raise exception 'FAIL: absurd-TTL insert was allowed';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- must be DENIED: deleting claims
  begin
    delete from hit_claims;
    raise exception 'FAIL: delete on hit_claims was allowed';
  exception when insufficient_privilege then null;
  end;

  -- must be DENIED: reading faction intel
  begin
    perform 1 from member_activity_snapshots limit 1;
    raise exception 'FAIL: member_activity_snapshots was readable';
  exception when insufficient_privilege then null;
  end;

  -- must SUCCEED: a normal claim
  insert into hit_claims (faction_id, target_player_id, claimer_torn_id, claimer_name, expires_at)
  values (tgh_faction_id(), 201, 111, 'SmokeTest', now() + interval '2 minutes');

  -- must be DENIED: the same person claiming that target again
  begin
    insert into hit_claims (faction_id, target_player_id, claimer_torn_id, claimer_name, expires_at)
    values (tgh_faction_id(), 201, 111, 'SmokeTest', now() + interval '2 minutes');
    raise exception 'FAIL: duplicate live claim was allowed';
  exception when unique_violation then null;
  end;

  -- must SUCCEED: releasing it
  update hit_claims set released_at = now()
   where claimer_torn_id = 111 and released_at is null;

  reset role;
  delete from hit_claims where claimer_name = 'SmokeTest';
  raise notice 'ALL CHECKS PASSED';
end $$;


-- ===========================================================================
-- 10. THREE THINGS TO DO IN THE APPS AFTERWARDS
-- ===========================================================================
-- 1. USERSCRIPT: put this project's URL and publishable (anon) key into
--    BAKED_IN at the top of thegreenhouse.user.js. Settings will show a
--    green "Built in" badge and your faction configures nothing but their
--    own Torn API key.
--
-- 2. WEBAPP (only if you're repointing it here): update
--    VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Vercel env vars
--    and redeploy. Do this so claims stay visible across both clients —
--    otherwise anyone still on the webapp's Hit Caller is invisible to
--    everyone on the script.
--
-- 3. WEBAPP CODE CHANGE, IMPORTANT: src/pages/ConfigPage.tsx currently
--    writes torn_api_key and ffs_api_key into faction_config. Those columns
--    no longer exist, so those writes will now fail. Strip them — the keys
--    belong in each client's own local storage, which is already where the
--    app reads them from. If you skip this, the Config page will error on
--    save.
-- ===========================================================================
