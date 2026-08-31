-- ===========================================================================
-- The Green House — Row Level Security setup
-- ===========================================================================
-- Run this in the Supabase SQL Editor. It is safe to re-run (idempotent).
--
-- BEFORE YOU RUN IT:
--   1. Replace every occurrence of 12345 with YOUR faction ID.
--      (Policies can't take parameters, so it has to be inlined. Use
--       Find & Replace on "12345".)
--   2. Read the note on faction_config below — that table currently holds
--      your Torn API key in plain text, and is the most important fix here.
--
-- WHAT THIS BUYS YOU
--   With the anon/publishable key baked into the userscript, anyone who reads
--   the script has that key. RLS is what makes that survivable. After this:
--     - Nobody can read your Torn or FFScouter API keys out of the database.
--     - Nobody can delete claims, or rewrite who claimed what.
--     - Claims can only be written scoped to YOUR faction id.
--     - No other table is reachable at all.
--
-- WHAT IT DOESN'T BUY YOU
--   The anon role has no identity — the database cannot tell a teammate from
--   a stranger holding the same key. So someone with the key can still insert
--   junk claims or delete a strike team. Closing that needs per-user identity
--   (the Edge Function token exchange we discussed). This file is the 80%.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. faction_config — DO THIS ONE FIRST
-- ---------------------------------------------------------------------------
-- This table has torn_api_key and ffs_api_key columns (the webapp's Config
-- page writes them). With RLS off, anyone holding the anon key can SELECT
-- your Torn API key straight out of it. That is a bigger exposure than
-- anything in the claims table.
--
-- The userscript does NOT need to read or write this table: every client
-- auto-detects the war from its own API key, so the shared copy is redundant.
-- We therefore lock it completely. (Set SYNC_WAR_TO_SUPABASE = false in the
-- userscript, which is the default, so nothing tries to write here.)

alter table faction_config enable row level security;

-- No policies at all => anon can do nothing. Your own dashboard access and
-- any service_role/secret-key backend still work normally.
drop policy if exists "anon read config"   on faction_config;
drop policy if exists "anon write config"  on faction_config;

-- Belt and braces: remove the column privileges too, so even a future
-- permissive policy can't leak the key columns.
revoke all on faction_config from anon;

-- If you still run the React webapp and it needs the shared config, do NOT
-- re-open this table. Instead move the two key columns out of it — they never
-- needed to be in a client-readable table. Something like:
--
--   alter table faction_config drop column torn_api_key;
--   alter table faction_config drop column ffs_api_key;
--
-- ...and let each client keep its own key locally (which the userscript
-- already does).


-- ---------------------------------------------------------------------------
-- 2. hit_claims — the coordination table
-- ---------------------------------------------------------------------------
alter table hit_claims enable row level security;

drop policy if exists "read claims"        on hit_claims;
drop policy if exists "insert own claims"  on hit_claims;
drop policy if exists "release claims"     on hit_claims;

-- Everyone needs to see the queue.
create policy "read claims"
  on hit_claims for select
  using (true);

-- Writes must be scoped to your faction and structurally sane. This rejects
-- claims aimed at other factions' scopes, zero/negative IDs, and absurd TTLs
-- (someone claiming a target until 2099).
create policy "insert own claims"
  on hit_claims for insert
  with check (
    faction_id        = 12345
    and target_player_id > 0
    and claimer_torn_id  > 0
    and claimer_name  is not null
    and length(claimer_name) between 1 and 40
    and expires_at    >  now()
    and expires_at    <= now() + interval '1 hour'
    and released_at   is null
  );

-- Releasing is the only permitted update, and only on a live claim.
create policy "release claims"
  on hit_claims for update
  using  (released_at is null)
  with check (released_at is not null);

-- A policy can't say "only this column may change", so use column privileges
-- to make released_at the ONLY writable column. This is what stops someone
-- rewriting claimer_name to steal a claim.
revoke update on hit_claims from anon;
grant  update (released_at) on hit_claims to anon;
grant  select on hit_claims to anon;
grant  insert on hit_claims to anon;

-- No DELETE policy and no delete grant => claims can never be deleted by a
-- client. Expiry (expires_at) and release (released_at) are the only exits.
revoke delete on hit_claims from anon;

-- Housekeeping: stop the table growing forever. Run occasionally, or attach
-- to pg_cron if you have it enabled.
--   delete from hit_claims where expires_at < now() - interval '30 days';


-- ---------------------------------------------------------------------------
-- 3. strike_teams / members / targets
-- ---------------------------------------------------------------------------
-- These need full CRUD from the client (creating, editing and deleting teams
-- are all features), so the policies here are permissive with sanity checks.
-- This is the weakest part of an anon-only setup: someone with the key can
-- delete a strike team. Accept it, or move to the token exchange.

alter table strike_teams         enable row level security;
alter table strike_team_members  enable row level security;
alter table strike_team_targets  enable row level security;

drop policy if exists "teams read"    on strike_teams;
drop policy if exists "teams insert"  on strike_teams;
drop policy if exists "teams update"  on strike_teams;
drop policy if exists "teams delete"  on strike_teams;

create policy "teams read"   on strike_teams for select using (true);
create policy "teams insert" on strike_teams for insert
  with check (
    name is not null
    and length(name) between 1 and 80
    and length(coalesce(description, '')) <= 500
    and leader_id is not null
  );
create policy "teams update" on strike_teams for update using (true) with check (
  length(name) between 1 and 80
);
create policy "teams delete" on strike_teams for delete using (true);

drop policy if exists "members read"   on strike_team_members;
drop policy if exists "members insert" on strike_team_members;
drop policy if exists "members update" on strike_team_members;
drop policy if exists "members delete" on strike_team_members;

create policy "members read"   on strike_team_members for select using (true);
create policy "members insert" on strike_team_members for insert
  with check (member_id is not null and length(member_name) between 1 and 40);
create policy "members update" on strike_team_members for update using (true) with check (true);
create policy "members delete" on strike_team_members for delete using (true);

-- Members: only readiness/invite state should be mutable from a client.
revoke update on strike_team_members from anon;
grant  update (ready_status, invite_status, position) on strike_team_members to anon;

drop policy if exists "targets read"   on strike_team_targets;
drop policy if exists "targets insert" on strike_team_targets;
drop policy if exists "targets update" on strike_team_targets;
drop policy if exists "targets delete" on strike_team_targets;

create policy "targets read"   on strike_team_targets for select using (true);
create policy "targets insert" on strike_team_targets for insert
  with check (target_id is not null and length(target_name) between 1 and 40);
create policy "targets update" on strike_team_targets for update using (true) with check (true);
create policy "targets delete" on strike_team_targets for delete using (true);

-- Targets: completion and ordering only.
revoke update on strike_team_targets from anon;
grant  update (completed, order_position, notes) on strike_team_targets to anon;


-- ---------------------------------------------------------------------------
-- 4. Tables the userscript never touches
-- ---------------------------------------------------------------------------
-- Enable RLS with no policies => fully closed to the anon key.
--
-- member_activity_snapshots holds per-member xanax/refill counts, which is
-- faction intel you probably don't want readable by anyone holding the key.

alter table member_activity_snapshots enable row level security;
revoke all on member_activity_snapshots from anon;

-- user_preferences is only used by the React webapp (the userscript keeps
-- theme locally).
alter table user_preferences enable row level security;

-- >>> ONLY IF YOU STILL RUN THE REACT WEBAPP, uncomment these two blocks,
-- >>> otherwise leave them closed.
--
-- create policy "prefs read"  on user_preferences for select using (true);
-- create policy "prefs write" on user_preferences for insert with check (true);
-- create policy "prefs update" on user_preferences for update using (true) with check (true);
-- grant select, insert, update on user_preferences to anon;
--
-- create policy "snapshots read"  on member_activity_snapshots for select using (true);
-- create policy "snapshots write" on member_activity_snapshots for insert with check (true);
-- grant select, insert on member_activity_snapshots to anon;


-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------
-- Every table should show rowsecurity = true:
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
order by relname;

-- Review what anon can actually do, column by column:
select table_name, column_name, privilege_type
from information_schema.column_privileges
where grantee = 'anon' and table_schema = 'public'
order by table_name, column_name;

-- And the policies themselves:
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ---------------------------------------------------------------------------
-- 6. Smoke test (run these to confirm it actually bites)
-- ---------------------------------------------------------------------------
-- Impersonate the anon role and check the important denials. Each of the
-- statements marked EXPECT: DENIED should raise an error.
--
-- set role anon;
--   select torn_api_key from faction_config;                    -- EXPECT: DENIED
--   delete from hit_claims;                                     -- EXPECT: DENIED
--   insert into hit_claims (faction_id, target_player_id, claimer_torn_id,
--     claimer_name, expires_at) values
--     (99999, 1, 1, 'x', now() + interval '5 min');              -- EXPECT: DENIED (wrong faction)
--   insert into hit_claims (faction_id, target_player_id, claimer_torn_id,
--     claimer_name, expires_at) values
--     (12345, 1, 1, 'x', now() + interval '10 years');           -- EXPECT: DENIED (absurd TTL)
--   insert into hit_claims (faction_id, target_player_id, claimer_torn_id,
--     claimer_name, expires_at) values
--     (12345, 201, 111, 'You', now() + interval '2 min');        -- EXPECT: OK
--   select * from member_activity_snapshots;                     -- EXPECT: DENIED
-- reset role;
