# Hidden Yeongdo – small-group tours on Yeongdo, Busan

Static site for GitHub Pages (HTML + CSS + vanilla JavaScript, no build step) with a
Supabase backend for bookings and questions, and Tawk.to for live chat.

## Pages
- `index.html` – hero, trip overview, three destinations, sunset widget, top questions
- `about.html` – story, founder, values
- `packages.html` – 1-Day Tour (hour-by-hour timeline), Half-day Sunset Walk, prices, booking terms
- `gallery.html` – filterable photo gallery, lightbox, media, OpenStreetMap (Leaflet)
- `faq.html` – common questions (accordion + search) and an "Ask your own question" form
- `contact.html` – booking form with live estimated total, plus phone / KakaoTalk / email
- `admin.html` – **your** dashboard: bookings and questions (not linked, `noindex`)

Every public page has a day/night toggle and a floating 💬 button: Live chat / Call / KakaoTalk / Email.

## Architecture

```
 Visitor's browser                          Supabase (your project)                 Resend
 ─────────────────                          ───────────────────────                 ──────
 GitHub Pages (static files)
   contact.html ──insert booking──────────▶ bookings  ─┐
   faq.html     ──insert question─────────▶ questions ─┴─ Database Webhook ─▶ Edge Function ─▶ email to
                                                          (on INSERT)        "notify"        chishtysheikh@gmail.com
 admin.html     ◀── (email+password login, admin only: read/update everything)
 💬 Live chat   ◀──▶ Tawk.to (you answer in the Tawk.to app)
```

- **The anon key in `js/supabase.js` is public.** That is normal for Supabase: Row Level Security
  (RLS) in `supabase/migrations/001_init.sql` decides what each person may do:
  - visitors may only **insert** bookings and questions, never read them;
  - chat visitors sign in anonymously and can only read/write **their own** conversation;
  - only the admin login (`chishtysheikh@gmail.com`) can read and update everything.
- Secret keys (Resend API key, service_role key, webhook secret) live **only** as Supabase secrets –
  never in this repository or the website.
- Spam protection: hidden honeypot field, length limits as database CHECK constraints, max 10 guests,
  consent required, chat limited to 1 message per 2 seconds (in the browser and in the database).
- Email rule for chat: you get an email for the **first** message of a new chat, and a reminder only if a
  visitor writes while the chat has been unread for more than 10 minutes (max one reminder per 10 minutes).

Files:
```
js/supabase.js                    Supabase URL + anon key, loads supabase-js 2.45.4 (pinned, with integrity hash) only when needed
js/admin.js, css/admin.css        admin dashboard
supabase/migrations/001_init.sql  tables, RLS policies, chat trigger, realtime, data-retention function
supabase/functions/notify/        Edge Function: sends the notification emails via Resend
supabase/tests/rls-test.mjs       automatic security test of the migration (runs locally, no project needed)
supabase/tests/console-check.js   security check to paste into the browser console on the live site
```

## Backend setup (once, about 30 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com → **New project**. Region: **Northeast Asia (Seoul)** (keeps data close to your guests).
2. Project Settings → **API**: copy the **Project URL** and the **anon public** key into
   `js/supabase.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Do **not** copy the `service_role` key anywhere.
3. Authentication → **URL Configuration** → Site URL: your GitHub Pages URL.

### 2. Run the database migration
Easiest: Dashboard → **SQL Editor** → New query → paste all of `supabase/migrations/001_init.sql` → **Run**.
You should see "Success. No rows returned". (Run it only once on a fresh project.)

Or with the CLI (see step 5 for installing it): `npx supabase db push`.

### 3. Create your admin login — do this before the site goes live
1. Authentication → **Users** → **Add user** → **Create new user**:
   email `chishtysheikh@gmail.com`, a long password, tick **Auto Confirm User**.
2. Authentication → **Sign In / Providers**:
   - turn **on** "Allow anonymous sign-ins" (needed for the chat);
   - Email provider: keep **Confirm email** on.
3. Open `admin.html` on your site and log in.

### 4. Resend (email)
1. Sign up at resend.com **with chishtysheikh@gmail.com** (the test sender `onboarding@resend.dev`
   can only deliver to the email address of your own Resend account).
2. API Keys → Create API key (permission: Sending access). Keep it for step 5 – never put it in a file.

### 5. Deploy the Edge Function (CLI)
Needs Node.js. In this folder:

```bash
npx supabase init                     # only the first time; answer "N" to the VS Code questions
npx supabase login                    # opens the browser
npx supabase link --project-ref YOUR_PROJECT_REF   # the "xxxx" in https://xxxx.supabase.co
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxx
npx supabase secrets set WEBHOOK_SECRET=$(openssl rand -hex 32)   # remember it: you need it in step 6
npx supabase secrets set ADMIN_URL=https://YOUR_NAME.github.io/YOUR_REPO/admin.html
npx supabase functions deploy notify --no-verify-jwt
```

To see the secret again later: you can't – just set a new one with the same command and update the webhooks.
`--no-verify-jwt` is correct here: the function checks the `x-webhook-secret` header instead.

### 6. Database Webhooks (email notifications)
Dashboard → **Integrations → Database Webhooks** (older dashboards: Database → Webhooks) → Enable → **Create a new hook**, three times:

| Name             | Table            | Events | Type                    | Function |
|------------------|------------------|--------|-------------------------|----------|
| notify-bookings  | public.bookings  | Insert | Supabase Edge Functions | notify   |
| notify-questions | public.questions | Insert | Supabase Edge Functions | notify   |
| notify-messages  | public.messages  | Insert | Supabase Edge Functions | notify   |

For each: Method **POST**, Timeout 5000 ms, and under **HTTP Headers** add
`x-webhook-secret` = the value you set as `WEBHOOK_SECRET`.

Test: send a booking on your site → you get an email within a few seconds.
Problems? Dashboard → Edge Functions → notify → **Logs**.

### 7. Security check on the live site
Open your site → F12 → Console → paste `supabase/tests/console-check.js`. Every line must say
**BLOCKED** or show an empty list `[]`.

Before you change the database later, you can run the automatic test locally:
`npm i @electric-sql/pglite@0.2.17 && node supabase/tests/rls-test.mjs` (46 checks).

### 8. Data retention (PIPA) – schedule the clean-up
`purge_old_data()` deletes closed chats and bookings more than 1 year old. Schedule it once:
Dashboard → Database → **Extensions** → enable `pg_cron`, then in the SQL Editor:

```sql
select cron.schedule('purge-old-data', '0 3 * * *', $$select public.purge_old_data()$$);
```

## Live chat (Tawk.to)
1. In tawk.to: Administration → Channels → Chat Widget. Your widget code contains a link like
   `https://embed.tawk.to/PROPERTY_ID/WIDGET_ID`.
2. Put the two parts in `js/main.js` (part 15): `TAWK_PROPERTY_ID` and `TAWK_WIDGET_ID`.
3. Tawk's own bubble is hidden; the chat opens from **💬 Live chat** in the floating contact menu, and a red
   badge shows when you have replied. If Tawk can't load (e.g. ad blockers), the option is hidden and
   Call / KakaoTalk / Email still work.
4. Tawk's chat window colours come from the Tawk dashboard (Chat Widget → Widget Appearance): choose the site
   teal `#1f6f78` so it matches. Install the Tawk.to app on your phone to answer chats.
5. Tawk.to stores chats and sets cookies: mention it in your privacy policy.

The database still has the chat tables from the earlier Supabase chat; they are unused now.

## Using admin.html
- **Bookings**: newest first (or by tour date), filter by status, change status, add a private note,
  click the email/phone to contact the guest. The tab shows how many are new.
- **Questions**: write an answer (reply to the guest by email – click their address), mark answered,
  **Copy as FAQ item** copies ready-made HTML for the accordion in `faq.html`.
- **Live chat** tab: belongs to the earlier Supabase chat and stays empty now – answer chats in Tawk.to.
  On your phone: add `admin.html` to your home screen for quick access.

## Backups
- Quick: in `admin.html` click **⬇ CSV** on Bookings and Questions (opens in Excel / Google Sheets).
- Everything: Dashboard → **Table Editor** → choose a table → **Export → Export as CSV**
  (bookings, questions, conversations, messages). Do this e.g. once a month and keep the files private:
  they contain personal data.

## Your business details (one place)
Contact details, prices and links that are not decided yet appear as `{{TOKENS}}` in the pages.
Fill in `site-info.json` and run `python3 tools/fill-info.py` – it writes the filled-in fields into every
page and lists what is still missing. You can run it again after filling in more fields.
Prices, phone, KakaoTalk ID and Gmail are already in the pages.

Search the project for `TODO` to find everything that still needs your decision.

## Adding a FAQ question
Copy one `<li class="faq-item">…</li>` block in `faq.html` (or use **Copy as FAQ item** in admin.html),
change the text and ids, and add the same question to the FAQPage JSON-LD in the page's `<head>`.

## Exchange rate
The "approx. US$" prices use `KRW_PER_USD` in `js/main.js` (part 13). Update it now and then.

## Formspree (optional fallback)
Forms are saved in Supabase. Only while `js/supabase.js` is still empty, the forms are sent to Formspree
instead if you put a Formspree form ID in `site-info.json`. Once Supabase works you don't need Formspree.

## Deploy on GitHub Pages
Push this folder to a repository → Settings → Pages → Deploy from branch `main` / root.
Then submit `sitemap.xml` in Google Search Console.
