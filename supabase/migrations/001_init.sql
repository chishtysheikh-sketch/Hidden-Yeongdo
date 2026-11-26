-- =========================================================
-- Hidden Yeongdo – database (Supabase / Postgres)
-- Run once: Supabase dashboard → SQL Editor → paste this file → Run
-- (or with the CLI: supabase db push). See README → "Backend setup".
--
-- Security model (the anon key in the website is public!):
--   * Row Level Security is ON for every table.
--   * Visitors may only INSERT bookings and questions, never read them.
--   * Chat visitors sign in anonymously; they can only read/write
--     their own conversation (visitor_id = auth.uid()).
--   * Only the admin account may read and update everything.
-- =========================================================

-- ---------- Admin check ----------
-- The admin is the signed-in, non-anonymous user with this email.
-- Create this user in Authentication → Users BEFORE the site goes live,
-- so nobody else can register the address.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'chishtysheikh@gmail.com'
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- ---------- bookings ----------
create table public.bookings (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  name            text not null check (char_length(name) between 2 and 100),
  email           text not null check (char_length(email) between 5 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone           text check (char_length(phone) <= 50),
  kakao_id        text check (char_length(kakao_id) <= 50),
  tour            text not null check (tour in ('1day', 'sunset', 'private', 'question')),
  tour_date       date check (tour_date >= date '2024-01-01' and tour_date <= date '2100-01-01'),
  adults          smallint not null default 0 check (adults between 0 and 10),
  students        smallint not null default 0 check (students between 0 and 10),
  children        smallint not null default 0 check (children between 0 and 10),
  estimated_total integer check (estimated_total between 0 and 10000000),
  message         text check (char_length(message) <= 2000),
  consent         boolean not null check (consent = true),
  status          text not null default 'new' check (status in ('new', 'confirmed', 'cancelled', 'done')),
  admin_note      text check (char_length(admin_note) <= 2000),
  check (adults + students + children <= 10)
);
create index bookings_created_at_idx on public.bookings (created_at desc);
create index bookings_status_idx on public.bookings (status);

-- ---------- questions ----------
create table public.questions (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 100),
  email       text not null check (char_length(email) between 5 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  question    text not null check (char_length(question) between 10 and 2000),
  consent     boolean not null check (consent = true),
  status      text not null default 'new' check (status in ('new', 'answered')),
  answer      text check (char_length(answer) <= 4000)
);
create index questions_created_at_idx on public.questions (created_at desc);
create index questions_status_idx on public.questions (status);

-- ---------- conversations (live chat) ----------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  visitor_id       uuid not null default auth.uid(),
  visitor_name     text not null check (char_length(visitor_name) between 1 and 100),
  visitor_email    text check (visitor_email is null or (char_length(visitor_email) <= 200 and visitor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  status           text not null default 'open' check (status in ('open', 'closed')),
  last_message_at  timestamptz not null default now(),
  unread_by_admin  boolean not null default false,
  -- used only for the "no email spam" rule (see messages_before_insert)
  unread_since     timestamptz,
  last_notified_at timestamptz
);
create index conversations_visitor_idx on public.conversations (visitor_id);
create index conversations_list_idx on public.conversations (unread_by_admin desc, last_message_at desc);
-- one open chat per visitor
create unique index conversations_one_open_per_visitor on public.conversations (visitor_id) where status = 'open';

-- ---------- messages ----------
create table public.messages (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender          text not null check (sender in ('visitor', 'admin')),
  body            text not null check (char_length(btrim(body)) between 1 and 1000),
  -- set by the trigger below, never by the client: true = email the admin (Edge Function "notify")
  notify_admin    boolean not null default false
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------- Chat trigger: rate limit, unread flag, email decision ----------
-- security definer: it updates the conversation row, which visitors may not update themselves.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.conversations%rowtype;
  first_message boolean;
begin
  select * into conv from public.conversations where id = new.conversation_id for update;

  new.created_at := now();
  new.notify_admin := false;

  if new.sender = 'visitor' then
    if conv.status <> 'open' then
      raise exception 'This conversation is closed';
    end if;
    -- server-side rate limit: max 1 visitor message per 2 seconds per conversation
    if exists (select 1 from public.messages m
               where m.conversation_id = new.conversation_id and m.sender = 'visitor'
                 and m.created_at > now() - interval '2 seconds') then
      raise exception 'Too many messages, please wait a moment';
    end if;

    first_message := not exists (select 1 from public.messages m where m.conversation_id = new.conversation_id);

    -- Email rule (no spam): the first message of a new conversation, or a message
    -- while the chat has been unread for more than 10 minutes
    -- (and at most one such reminder every 10 minutes).
    if first_message then
      new.notify_admin := true;
    elsif conv.unread_by_admin and conv.unread_since < now() - interval '10 minutes'
          and (conv.last_notified_at is null or conv.last_notified_at < now() - interval '10 minutes') then
      new.notify_admin := true;
    end if;

    update public.conversations set
      last_message_at  = now(),
      unread_by_admin  = true,
      unread_since     = case when conv.unread_by_admin then conv.unread_since else now() end,
      last_notified_at = case when new.notify_admin then now() else conv.last_notified_at end
    where id = new.conversation_id;
  else
    -- admin reply: the chat is read
    update public.conversations set
      last_message_at = now(), unread_by_admin = false, unread_since = null
    where id = new.conversation_id;
  end if;

  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- ---------- Row Level Security ----------
alter table public.bookings      enable row level security;
alter table public.questions     enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- bookings: anyone may send one (status and admin_note stay empty); only the admin reads/changes
create policy "anyone can create a booking" on public.bookings
  for insert to anon, authenticated
  with check (status = 'new' and admin_note is null);
create policy "admin reads bookings" on public.bookings
  for select to authenticated using (public.is_admin());
create policy "admin updates bookings" on public.bookings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes bookings" on public.bookings
  for delete to authenticated using (public.is_admin());

-- questions: same idea
create policy "anyone can ask a question" on public.questions
  for insert to anon, authenticated
  with check (status = 'new' and answer is null);
create policy "admin reads questions" on public.questions
  for select to authenticated using (public.is_admin());
create policy "admin updates questions" on public.questions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes questions" on public.questions
  for delete to authenticated using (public.is_admin());

-- conversations: a visitor creates and reads only their own; only the admin updates (e.g. closes)
create policy "visitor creates own conversation" on public.conversations
  for insert to authenticated
  with check (visitor_id = auth.uid() and status = 'open' and unread_by_admin = false
              and unread_since is null and last_notified_at is null);
create policy "visitor reads own conversations" on public.conversations
  for select to authenticated using (visitor_id = auth.uid() or public.is_admin());
create policy "admin updates conversations" on public.conversations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes conversations" on public.conversations
  for delete to authenticated using (public.is_admin());

-- messages: a visitor reads/writes only in their own open conversation, as 'visitor'
create policy "visitor reads own messages" on public.messages
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.visitor_id = auth.uid()));
create policy "visitor writes in own conversation" on public.messages
  for insert to authenticated with check (
    sender = 'visitor' and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.visitor_id = auth.uid() and c.status = 'open'));
create policy "admin writes messages" on public.messages
  for insert to authenticated with check (public.is_admin() and sender = 'admin');
create policy "admin deletes messages" on public.messages
  for delete to authenticated using (public.is_admin());

-- Table privileges: RLS above decides WHICH ROWS, these grants decide WHICH COLUMNS.
-- Visitors can only fill in the form fields: id, created_at, status, admin_note,
-- answer, visitor_id, unread flags and notify_admin are always set by the database.
revoke all on public.bookings, public.questions, public.conversations, public.messages from anon, authenticated;
grant insert (name, email, phone, kakao_id, tour, tour_date, adults, students, children,
              estimated_total, message, consent) on public.bookings to anon, authenticated;
grant insert (name, email, question, consent) on public.questions to anon, authenticated;
grant insert (visitor_name, visitor_email) on public.conversations to authenticated;
grant insert (conversation_id, sender, body) on public.messages to authenticated;
-- reading is still limited by RLS (visitors: own chat only; bookings/questions: admin only)
grant select on public.bookings, public.questions, public.conversations, public.messages to authenticated;
-- only the admin passes the RLS update/delete policies
grant update (status, admin_note) on public.bookings to authenticated;
grant update (status, answer) on public.questions to authenticated;
grant update (status, unread_by_admin) on public.conversations to authenticated;
grant delete on public.bookings, public.questions, public.conversations, public.messages to authenticated;

-- ---------- Realtime (live chat) ----------
-- Realtime respects the RLS policies above: a visitor only receives their own rows.
alter publication supabase_realtime add table public.messages, public.conversations;

-- =========================================================
-- Data retention (PIPA, Korea's Personal Information Protection Act)
-- Keep personal data only as long as needed: closed chats and old
-- bookings are deleted after 1 year.
--
-- TODO (you): schedule it once a day with pg_cron:
--   1. Dashboard → Database → Extensions → enable "pg_cron"
--   2. SQL Editor:
--        select cron.schedule('purge-old-data', '0 3 * * *', $$select public.purge_old_data()$$);
--   Check it with: select * from cron.job;
-- =========================================================
create or replace function public.purge_old_data()
returns void
language sql
security definer
set search_path = ''
as $$
  -- closed chats (their messages are deleted with them: on delete cascade)
  delete from public.conversations
   where status = 'closed' and last_message_at < now() - interval '1 year';
  -- bookings whose tour (or, without a date, whose request) is more than a year ago
  delete from public.bookings
   where coalesce(tour_date::timestamptz, created_at) < now() - interval '1 year';
  -- anonymous chat accounts that no longer have a conversation
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '1 year'
     and not exists (select 1 from public.conversations c where c.visitor_id = u.id);
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;
