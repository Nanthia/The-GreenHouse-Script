/* Runs new_project_setup.sql against a real Postgres (PGlite/WASM) to verify
 * it executes cleanly and that the security actually behaves as claimed.
 * Usage: node sqltest.cjs ./new_project_setup.sql
 */
const fs = require("fs");
const { PGlite } = require("@electric-sql/pglite");

const sqlPath = process.argv[2];
let sql = fs.readFileSync(sqlPath, "utf8");

(async () => {
  const db = await PGlite.create();

  // Supabase provides these roles; a bare Postgres doesn't.
  await db.exec(`create role anon nologin; create role authenticated nologin;
                 grant usage on schema public to anon, authenticated;`);

  console.log("=== 1. Running the setup script ===");
  try {
    await db.exec(sql);
    console.log("OK — script executed with no errors");
  } catch (e) {
    console.error("FAILED: " + e.message);
    process.exit(1);
  }

  console.log("\n=== 2. Re-running it (must be idempotent) ===");
  try {
    await db.exec(sql);
    console.log("OK — safe to re-run");
  } catch (e) {
    console.error("FAILED on re-run: " + e.message);
    process.exit(1);
  }

  console.log("\n=== 3. RLS enabled on every table? ===");
  const rls = await db.query(`select relname, relrowsecurity from pg_class
     where relnamespace='public'::regnamespace and relkind='r' order by relname`);
  rls.rows.forEach((r) => console.log(`  ${r.relrowsecurity ? "yes" : "NO !!"}  ${r.relname}`));
  if (rls.rows.some((r) => !r.relrowsecurity)) { console.error("FAILED: a table has RLS off"); process.exit(1); }

  console.log("\n=== 4. What can anon actually write? ===");
  const privs = await db.query(`select table_name, privilege_type,
      string_agg(column_name, ', ' order by column_name) cols
    from information_schema.column_privileges
    where grantee='anon' and table_schema='public'
    group by table_name, privilege_type order by table_name, privilege_type`);
  privs.rows.forEach((r) => console.log(`  ${r.table_name} ${r.privilege_type}: ${r.cols}`));

  const hcUpdate = privs.rows.find((r) => r.table_name === "hit_claims" && r.privilege_type === "UPDATE");
  console.log(`\n  hit_claims UPDATE restricted to released_at only: ${hcUpdate && hcUpdate.cols === "released_at" ? "YES" : "NO !! -> " + (hcUpdate && hcUpdate.cols)}`);

  console.log("\n=== 5. No API key columns exist anywhere ===");
  const keycols = await db.query(`select table_name, column_name from information_schema.columns
     where table_schema='public' and (column_name ilike '%api_key%' or column_name ilike '%torn_api%')`);
  console.log(keycols.rows.length === 0 ? "  OK — none found" : "  FOUND: " + JSON.stringify(keycols.rows));

  console.log("\n=== 6. Security behaviour as the anon role ===");
  const asAnon = async (label, stmt, expect) => {
    try {
      await db.exec(`set role anon; ${stmt}; reset role;`);
      await db.exec(`reset role`);
      const pass = expect === "allow";
      console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} -> allowed${pass ? "" : " (should have been denied!)"}`);
      return pass;
    } catch (e) {
      await db.exec(`reset role`).catch(() => {});
      const pass = expect === "deny";
      console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} -> denied (${e.message.split("\n")[0].slice(0, 70)})`);
      return pass;
    }
  };

  const results = [];
  results.push(await asAnon("read claims", `select 1 from hit_claims`, "allow"));
  results.push(await asAnon("valid claim insert",
    `insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,expires_at)
     values (tgh_faction_id(),201,111,'Tester',now()+interval '2 minutes')`, "allow"));
  results.push(await asAnon("duplicate live claim",
    `insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,expires_at)
     values (tgh_faction_id(),201,111,'Tester',now()+interval '2 minutes')`, "deny"));
  results.push(await asAnon("wrong faction",
    `insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,expires_at)
     values (999999,5,5,'Bad',now()+interval '2 minutes')`, "deny"));
  results.push(await asAnon("absurd TTL",
    `insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,expires_at)
     values (tgh_faction_id(),6,6,'Bad',now()+interval '10 years')`, "deny"));
  results.push(await asAnon("delete a claim", `delete from hit_claims`, "deny"));
  results.push(await asAnon("steal a claim (rewrite claimer_name)",
    `update hit_claims set claimer_name='Thief'`, "deny"));
  results.push(await asAnon("release own claim",
    `update hit_claims set released_at=now() where claimer_torn_id=111`, "allow"));
  results.push(await asAnon("backdate a claim to jump the queue",
    `insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,created_at,expires_at)
     values (tgh_faction_id(),300,300,'Jumper','1990-01-01',now()+interval '2 minutes')`, "deny"));
  results.push(await asAnon("read faction intel", `select 1 from member_activity_snapshots`, "deny"));
  results.push(await asAnon("write faction_config", `update faction_config set enemy_faction_id='666'`, "deny"));
  results.push(await asAnon("read faction_config", `select 1 from faction_config`, "allow"));
  results.push(await asAnon("create a strike team",
    `insert into strike_teams (name,leader_id,leader_name) values ('Op Test','111','Tester')`, "allow"));
  results.push(await asAnon("team with absurd name",
    `insert into strike_teams (name,leader_id,leader_name) values (repeat('x',200),'111','T')`, "deny"));

  console.log("\n=== 7. updated_at trigger ===");
  await db.exec(`insert into strike_teams (id,name,leader_id,leader_name)
                 values ('11111111-1111-1111-1111-111111111111','TriggerTest','1','T')`);
  await db.exec(`update strike_teams set updated_at='2000-01-01'
                 where id='11111111-1111-1111-1111-111111111111'`);
  const t = await db.query(`select updated_at > now() - interval '1 minute' as fresh
                            from strike_teams where id='11111111-1111-1111-1111-111111111111'`);
  console.log(`  ${t.rows[0].fresh ? "PASS" : "FAIL"}  updated_at is forced to now() on update`);
  results.push(!!t.rows[0].fresh);

  console.log("\n=== 8. Cascade delete ===");
  await db.exec(`insert into strike_team_members (team_id,member_id,member_name)
                 values ('11111111-1111-1111-1111-111111111111','9','M')`);
  await db.exec(`delete from strike_teams where id='11111111-1111-1111-1111-111111111111'`);
  const orphans = await db.query(`select count(*)::int n from strike_team_members
                                  where team_id='11111111-1111-1111-1111-111111111111'`);
  console.log(`  ${orphans.rows[0].n === 0 ? "PASS" : "FAIL"}  members removed with their team`);
  results.push(orphans.rows[0].n === 0);

  console.log("\n=== 9. Prune function ===");
  await db.exec(`insert into hit_claims (faction_id,target_player_id,claimer_torn_id,claimer_name,created_at,expires_at)
                 values (tgh_faction_id(),777,777,'Old',now()-interval '60 days',now()-interval '59 days')`);
  const pruned = await db.query(`select tgh_prune_hit_claims() n`);
  console.log(`  pruned ${pruned.rows[0].n} stale claim(s) — ${Number(pruned.rows[0].n) >= 1 ? "PASS" : "FAIL"}`);
  results.push(Number(pruned.rows[0].n) >= 1);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${failed === 0 ? "*** ALL CHECKS PASSED ***" : `*** ${failed} CHECK(S) FAILED ***`}`);
  process.exit(failed === 0 ? 0 : 1);
})();
