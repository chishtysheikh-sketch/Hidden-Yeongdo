/* =========================================================
   Hidden Yeongdo – Supabase connection (bookings, questions, live chat)

   The anon key below is PUBLIC by design (everyone can see it in the
   browser). What visitors may do is decided by Row Level Security in
   supabase/migrations/001_init.sql: they can only send bookings and
   questions and read their own chat.
   NEVER put the service_role key or the Resend API key in this file.

   The supabase-js library (~110 KB) is only downloaded when it is needed:
   when a form is sent or the chat is used.
   ========================================================= */

const SUPABASE_URL = "";      // TODO: Supabase → Project Settings → API → Project URL (https://xxxx.supabase.co)
const SUPABASE_ANON_KEY = ""; // TODO: Supabase → Project Settings → API → "anon public" key
const ADMIN_EMAIL = "chishtysheikh@gmail.com";

// pinned version + integrity hash: the browser refuses the file if the CDN ever changes it
const SUPABASE_LIB = {
  src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  integrity: "sha384-0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o"
};

const HY_DB = (function () {
  const clients = {};
  let libPromise = null;

  function configured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  function loadLib() {
    if (window.supabase) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        const s = document.createElement("script");
        s.src = SUPABASE_LIB.src;
        s.integrity = SUPABASE_LIB.integrity;
        s.crossOrigin = "anonymous";
        s.onload = resolve;
        s.onerror = function () { libPromise = null; reject(new Error("Could not load Supabase")); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  // "visitor" (forms + chat) and "admin" keep separate logins in the browser,
  // so testing the chat on the same computer as admin.html does not log you out.
  function client(kind) {
    kind = kind || "visitor";
    if (!configured()) return Promise.reject(new Error("Supabase is not set up yet (js/supabase.js)"));
    if (!clients[kind]) {
      clients[kind] = loadLib().then(function () {
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: "hy-" + kind + "-auth" }
        });
      }).catch(function (e) { delete clients[kind]; throw e; });
    }
    return clients[kind];
  }

  // true if this browser already has a chat login (so we can show unread replies)
  function hasSession(kind) {
    try { return Boolean(localStorage.getItem("hy-" + (kind || "visitor") + "-auth")); } catch (e) { return false; }
  }

  return { configured: configured, client: client, hasSession: hasSession, ADMIN_EMAIL: ADMIN_EMAIL };
})();
