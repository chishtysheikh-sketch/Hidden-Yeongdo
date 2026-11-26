// Database security test: runs supabase/migrations/001_init.sql in PGlite (Postgres in Node)
// and checks every Row Level Security rule as anon, two visitors and the admin.
// Run:  npm i @electric-sql/pglite@0.2.17  &&  node supabase/tests/rls-test.mjs
// (does not touch your real Supabase project)
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };

// --- stand-ins for what Supabase already provides ---
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, created_at timestamptz default now(), is_anonymous boolean default false, email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create publication supabase_realtime;
`);
await db.exec(fs.readFileSync(process.argv[2] || new URL("../migrations/001_init.sql", import.meta.url), "utf8"));
console.log("migration ran OK");

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", ADM = "99999999-9999-9999-9999-999999999999";
const who = {
  anon: ["anon", {}],
  visitorA: ["authenticated", { sub: A, is_anonymous: true }],
  visitorB: ["authenticated", { sub: B, is_anonymous: true }],
  fakeAdmin: ["authenticated", { sub: B, is_anonymous: true, email: "chishtysheikh@gmail.com" }],
  otherUser: ["authenticated", { sub: B, email: "someone@example.com" }],
  admin: ["authenticated", { sub: ADM, email: "chishtysheikh@gmail.com", is_anonymous: false }],
};
async function as(name, sql, params = []) {
  const [role, claims] = who[name];
  try {
    return await db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${role}`);
      const r = await tx.query(sql, params);
      return { rows: r.rows, count: r.affectedRows };
    });
  } catch (e) { return { error: e.message }; }
}
const booking = `insert into bookings (name,email,tour,tour_date,adults,students,children,estimated_total,message,consent)
                 values ('Kim','kim@example.com','1day','2027-03-06',2,1,0,160500,'hi',true)`;

console.log("\n-- bookings & questions --");
ok(!(await as("anon", booking)).error, "anon can insert a booking");
ok(!(await as("visitorA", booking)).error, "signed-in visitor can insert a booking");
let r = await as("anon", "select * from bookings");
ok(r.error && /permission denied/.test(r.error), "anon cannot read bookings: " + (r.error || r.rows.length + " rows"));
r = await as("visitorA", "select * from bookings");
ok(!r.error && r.rows.length === 0, "visitor sees 0 bookings (RLS)");
r = await as("fakeAdmin", "select * from bookings");
ok(!r.error && r.rows.length === 0, "anonymous user with admin email in token sees 0 bookings");
r = await as("otherUser", "update bookings set status='confirmed'");
ok(r.error || r.count === 0, "non-admin cannot update bookings");
r = await as("anon", `insert into bookings (name,email,tour,consent,status) values ('Kim','kim@example.com','1day',true,'confirmed')`);
ok(r.error && /permission denied/.test(r.error), "visitor cannot set status column");
r = await as("anon", `insert into bookings (name,email,tour,consent) values ('Kim','kim@example.com','1day',false)`);
ok(r.error && /check/.test(r.error), "consent=false rejected");
r = await as("anon", `insert into bookings (name,email,tour,consent,message) values ('Kim','kim@example.com','1day',true,repeat('x',2001))`);
ok(r.error && /check/.test(r.error), "message > 2000 chars rejected");
r = await as("anon", `insert into bookings (name,email,tour,consent,adults,students) values ('Kim','kim@example.com','1day',true,8,3)`);
ok(r.error && /check/.test(r.error), "more than 10 guests rejected");
r = await as("anon", `insert into bookings (name,email,tour,consent) values ('Kim','not-an-email','1day',true)`);
ok(r.error && /check/.test(r.error), "bad email rejected");
ok(!(await as("anon", `insert into questions (name,email,question,consent) values ('Lee','lee@example.com','Can kids join the hike?',true)`)).error, "anon can ask a question");
r = await as("anon", "select * from questions");
ok(r.error, "anon cannot read questions");
r = await as("anon", `insert into questions (name,email,question,consent) values ('Lee','lee@example.com','short',true)`);
ok(r.error && /check/.test(r.error), "question < 10 chars rejected");
r = await as("admin", "select * from bookings");
ok(!r.error && r.rows.length === 2, "admin reads all bookings (" + (r.rows || []).length + ")");
r = await as("admin", "update bookings set status='confirmed', admin_note='paid' where id=1");
ok(!r.error && r.count === 1, "admin updates status + note");
r = await as("admin", "select * from questions");
ok(!r.error && r.rows.length === 1, "admin reads questions");

console.log("\n-- live chat --");
r = await as("anon", "insert into conversations (visitor_name) values ('Anon')");
ok(r.error, "not signed in: cannot start a chat");
r = await as("visitorA", "insert into conversations (visitor_name, visitor_email) values ('Anna','anna@example.com') returning id, visitor_id");
ok(!r.error && r.rows[0].visitor_id === A, "visitor A starts a chat (visitor_id = auth.uid())");
const convA = r.rows[0].id;
r = await as("visitorA", `insert into conversations (visitor_name, visitor_id) values ('Anna', '${B}')`);
ok(r.error, "visitor cannot pick another visitor_id");
r = await as("visitorA", "insert into conversations (visitor_name) values ('Anna again')");
ok(r.error && /unique/.test(r.error), "only one open chat per visitor");
r = await as("visitorB", "insert into conversations (visitor_name) values ('Ben') returning id");
const convB = r.rows[0].id;
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','Hello!') returning notify_admin", [convA]);
ok(!r.error && r.rows[0].notify_admin === true, "first message -> email admin (notify_admin=true)");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','Are you there?')", [convA]);
ok(r.error && /Too many/.test(r.error), "2nd message within 2 s rejected (rate limit)");
await db.query("update messages set created_at = now() - interval '3 seconds'");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','Are you there?') returning notify_admin", [convA]);
ok(!r.error && r.rows[0].notify_admin === false, "2nd message after 2 s: allowed, no email");
await db.query("update messages set created_at = now() - interval '11 minutes'");
await db.query("update conversations set unread_since = now() - interval '11 minutes', last_notified_at = now() - interval '11 minutes' where id=$1", [convA]);
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','Still waiting') returning notify_admin", [convA]);
ok(!r.error && r.rows[0].notify_admin === true, "unread > 10 min -> reminder email");
await db.query("update messages set created_at = now() - interval '1 minute'");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','Hello??') returning notify_admin", [convA]);
ok(!r.error && r.rows[0].notify_admin === false, "right after a reminder: no new email");
r = await as("visitorA", "insert into messages (conversation_id, sender, body, notify_admin) values ($1,'visitor','spam me', true)", [convA]);
ok(r.error && /permission denied/.test(r.error), "visitor cannot set notify_admin");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'admin','I am the admin')", [convA]);
ok(r.error, "visitor cannot write as 'admin'");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','hi B')", [convB]);
ok(r.error, "visitor A cannot write into B's chat");
r = await as("visitorB", "select * from messages");
ok(!r.error && r.rows.length === 0, "visitor B sees 0 of A's messages");
r = await as("visitorB", "select * from conversations");
ok(!r.error && r.rows.length === 1 && r.rows[0].id === convB, "visitor B sees only own conversation");
r = await as("visitorA", "select body from messages order by id");
ok(!r.error && r.rows.length === 4, "visitor A sees own 4 messages");
r = await as("visitorA", "update conversations set status='closed' where id=$1", [convA]);
ok(r.error || r.count === 0, "visitor cannot update conversation");
r = await as("visitorA", "delete from messages");
ok(r.error || r.count === 0, "visitor cannot delete messages");
await db.query("update messages set created_at = now() - interval '1 minute'");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor',$2)", [convA, "x".repeat(1001)]);
ok(r.error && /check/.test(r.error), "message > 1000 chars rejected");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','   ')", [convA]);
ok(r.error && /check/.test(r.error), "empty message rejected");
r = await as("admin", "select * from conversations order by unread_by_admin desc, last_message_at desc");
ok(!r.error && r.rows.length === 2 && r.rows[0].id === convA && r.rows[0].unread_by_admin, "admin sees all chats, unread first");
r = await as("admin", "insert into messages (conversation_id, sender, body) values ($1,'admin','Hi Anna, Utsho here!')", [convA]);
ok(!r.error, "admin replies");
r = await as("admin", "select unread_by_admin from conversations where id=$1", [convA]);
ok(r.rows[0].unread_by_admin === false, "admin reply clears unread");
r = await as("visitorA", "select body from messages where sender='admin'");
ok(r.rows.length === 1, "visitor A sees the admin reply");
r = await as("admin", "update conversations set status='closed' where id=$1", [convA]);
ok(!r.error && r.count === 1, "admin closes chat");
await db.query("update messages set created_at = now() - interval '1 minute'");
r = await as("visitorA", "insert into messages (conversation_id, sender, body) values ($1,'visitor','one more')", [convA]);
ok(r.error, "visitor cannot write in a closed chat");
r = await as("visitorA", "insert into conversations (visitor_name) values ('Anna') returning id");
ok(!r.error, "after close, visitor can start a new chat");

console.log("\n-- retention --");
r = await as("anon", "select public.purge_old_data()");
ok(r.error, "visitors cannot run purge_old_data()");
await db.query("update conversations set last_message_at = now() - interval '13 months' where id=$1", [convA]);
await db.query("update bookings set tour_date = now() - interval '13 months' where id=1");
await db.query("select public.purge_old_data()");
const left = await db.query("select (select count(*) from conversations where id=$1) c, (select count(*) from messages where conversation_id=$1) m, (select count(*) from bookings) b", [convA]);
ok(left.rows[0].c == 0 && left.rows[0].m == 0 && left.rows[0].b == 1, "purge deletes old closed chat + its messages + old booking, keeps the rest");
const pol = await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity");
ok(pol.rows.length === 0, "RLS enabled on every table");
console.log(`\n${pass} passed, ${fail} failed`);
