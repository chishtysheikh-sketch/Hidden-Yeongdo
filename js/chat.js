/* =========================================================
   Hidden Yeongdo – live chat widget (all public pages)

   Opened from the floating 💬 button ("Live chat"). Uses Supabase
   (js/supabase.js): the visitor signs in anonymously, so the same chat
   continues on every page and when they come back later in this browser.
   New messages arrive in real time (Supabase Realtime) in both directions.

   1. Panel HTML   2. Open / close   3. Start a chat   4. Connect + realtime
   5. Show messages + unread badge   6. Send (Enter, 1 message per 2 s)
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  if (typeof HY_DB === "undefined" || !HY_DB.configured()) return; // chat hidden until Supabase is set up
  setupChat();
});

function setupChat() {
  const CONV_KEY = "hy-chat-conversation";
  const MIN_GAP_MS = 2000; // client-side rate limit (the database also allows max 1 message / 2 s)

  const fabBtn = document.querySelector(".fab-btn");
  const fabChat = document.querySelector(".fab-chat");
  const badge = document.querySelector(".fab-badge");
  if (!fabBtn || !fabChat) return;
  fabChat.hidden = false;

  /* ---------- 1. Panel HTML (one copy for every page) ---------- */
  const panel = document.createElement("section");
  panel.className = "chat-panel";
  panel.id = "chat-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "chat-title");
  panel.innerHTML =
    '<div class="chat-head">' +
      '<div><h2 id="chat-title">Live chat</h2><p class="chat-sub">with Utsho, Hidden Yeongdo</p></div>' +
      '<button type="button" class="chat-close" aria-label="Close chat">✕</button>' +
    '</div>' +
    '<p class="chat-note">Utsho usually replies within a few hours. For urgent questions call ' +
      '<a href="tel:+821043294220">010-4329-4220</a> or KakaoTalk: <strong>chishty</strong> ' +
      '<button type="button" class="copy-btn" data-copy="chishty">Copy ID</button></p>' +
    '<form class="chat-start" novalidate>' +
      '<div class="form-group"><label for="chat-name">Your name</label>' +
        '<input id="chat-name" name="name" type="text" autocomplete="name" maxlength="100" required>' +
        '<p class="error" id="chat-name-error"></p></div>' +
      '<div class="form-group"><label for="chat-email">Email <span class="opt">(optional, so we can reply if you leave)</span></label>' +
        '<input id="chat-email" name="email" type="email" autocomplete="email" maxlength="200">' +
        '<p class="error" id="chat-email-error"></p></div>' +
      '<div class="form-group"><label class="check"><input id="chat-consent" name="consent" type="checkbox">' +
        '<span>I agree that Hidden Yeongdo stores this chat to answer me. Chats are deleted one year after they are closed.</span></label>' +
        '<p class="error" id="chat-consent-error"></p></div>' +
      '<button class="btn" type="submit">Start chat</button>' +
    '</form>' +
    '<div class="chat-body" hidden>' +
      '<ol class="chat-log" role="log" aria-live="polite" aria-label="Chat messages"></ol>' +
      '<p class="chat-closed" hidden>This chat was closed. <button type="button" class="chat-new">Start a new chat</button></p>' +
      '<form class="chat-send" novalidate>' +
        '<label class="sr-only" for="chat-input">Your message</label>' +
        '<textarea id="chat-input" rows="2" maxlength="1000" placeholder="Type a message… (Enter to send)"></textarea>' +
        '<button type="submit" class="chat-send-btn" aria-label="Send message">➤</button>' +
      '</form>' +
    '</div>' +
    '<p class="chat-error" role="alert"></p>';
  document.body.appendChild(panel);

  const startForm = panel.querySelector(".chat-start");
  const body = panel.querySelector(".chat-body");
  const log = panel.querySelector(".chat-log");
  const sendForm = panel.querySelector(".chat-send");
  const input = panel.querySelector("#chat-input");
  const errorEl = panel.querySelector(".chat-error");
  const closedNote = panel.querySelector(".chat-closed");

  let db = null;          // Supabase client
  let conv = null;        // { id, status }
  let channel = null;     // realtime subscription
  let lastSent = 0;
  let unread = 0;
  const shown = {};       // message ids already on screen

  function stored() { try { return localStorage.getItem(CONV_KEY); } catch (e) { return null; } }
  function store(id) { try { id ? localStorage.setItem(CONV_KEY, id) : localStorage.removeItem(CONV_KEY); } catch (e) { /* ignore */ } }
  function seenKey() { return "hy-chat-seen-" + (conv ? conv.id : ""); }
  function lastSeen() { try { return parseInt(localStorage.getItem(seenKey()), 10) || 0; } catch (e) { return 0; } }
  function setSeen(id) { try { if (id > lastSeen()) localStorage.setItem(seenKey(), id); } catch (e) { /* ignore */ } }

  function showError(text) {
    errorEl.innerHTML = text ? text + ' Please call <a href="tel:+821043294220">010-4329-4220</a> or KakaoTalk <strong>chishty</strong>.' : "";
  }

  /* ---------- 2. Open / close ---------- */
  function open() {
    document.dispatchEvent(new Event("hy-fab-close"));
    panel.hidden = false;
    document.body.classList.add("chat-open");
    showError("");
    if (conv) {
      showChat();
    } else if (HY_DB.hasSession() && stored()) {
      connect(stored()).then(function (found) { found ? showChat() : showStart(); });
    } else {
      showStart();
    }
  }
  function close() {
    panel.hidden = true;
    document.body.classList.remove("chat-open");
    fabBtn.focus();
  }
  function showStart() {
    startForm.hidden = false;
    body.hidden = true;
    panel.querySelector("#chat-name").focus();
  }
  function showChat() {
    startForm.hidden = true;
    body.hidden = false;
    markAllSeen();
    log.scrollTop = log.scrollHeight;
    if (conv.status === "open") input.focus();
  }

  fabChat.addEventListener("click", open);
  panel.querySelector(".chat-close").addEventListener("click", close);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  /* ---------- 3. Start a chat: name (+ email) + consent ---------- */
  const validator = createValidator(startForm, {
    name: function (v) { return v.trim().length >= 1 || "Please enter your name."; },
    email: function (v) { return v.trim() === "" || isEmail(v) || "Please enter a valid email, or leave it empty."; },
    consent: function (checked) { return checked || "Please tick the box to start the chat."; }
  }, "chat-");

  startForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validator.checkAll()) return;
    const button = startForm.querySelector("button[type=submit]");
    button.disabled = true;
    showError("");
    const name = startForm.elements.name.value.trim();
    const email = startForm.elements.email.value.trim() || null;

    getClient()
      .then(function () { return db.auth.getSession(); })
      .then(function (res) {
        if (res.data.session) return null;
        return db.auth.signInAnonymously().then(function (r) { if (r.error) throw r.error; });
      })
      .then(function () {
        return db.from("conversations").insert({ visitor_name: name, visitor_email: email }).select("id, status").single();
      })
      .then(function (res) {
        // already has an open chat (e.g. started in another tab): continue that one
        if (res.error && res.error.code === "23505") {
          return db.from("conversations").select("id, status").eq("status", "open").limit(1).single();
        }
        return res;
      })
      .then(function (res) {
        if (res.error) throw res.error;
        store(res.data.id);
        return connect(res.data.id);
      })
      .then(function () { showChat(); })
      .catch(function (err) {
        console.error(err);
        showError("Sorry, the chat is not available right now.");
      })
      .finally(function () { button.disabled = false; });
  });

  panel.querySelector(".chat-new").addEventListener("click", function () {
    if (channel) { db.removeChannel(channel); channel = null; }
    conv = null;
    store(null);
    log.innerHTML = "";
    Object.keys(shown).forEach(function (k) { delete shown[k]; });
    closedNote.hidden = true;
    sendForm.hidden = false;
    showStart();
  });

  /* ---------- 4. Connect to a conversation + realtime ---------- */
  function getClient() {
    if (db) return Promise.resolve(db);
    return HY_DB.client().then(function (c) { db = c; return c; });
  }

  // returns true if the conversation still exists for this visitor
  function connect(id) {
    return getClient()
      .then(function () { return db.from("conversations").select("id, status").eq("id", id).maybeSingle(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data) { store(null); return false; } // deleted, or a different login
        conv = res.data;
        setClosed(conv.status === "closed");
        subscribe();
        return loadMessages().then(function () { return true; });
      })
      .catch(function (err) { console.error(err); return false; });
  }

  function loadMessages() {
    return db.from("messages").select("id, created_at, sender, body")
      .eq("conversation_id", conv.id).order("created_at", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        res.data.forEach(function (m) { addMessage(m, true); });
        updateBadge();
      });
  }

  function subscribe() {
    if (channel) return;
    channel = db.channel("chat-" + conv.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + conv.id },
        function (payload) { addMessage(payload.new, false); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations", filter: "id=eq." + conv.id },
        function (payload) { conv.status = payload.new.status; setClosed(conv.status === "closed"); })
      .subscribe(function (status) {
        // after a reconnect, fetch anything we missed (duplicates are skipped)
        if (status === "SUBSCRIBED") loadMessages().catch(function () { /* offline */ });
      });
  }

  function setClosed(closed) {
    closedNote.hidden = !closed;
    sendForm.hidden = closed;
  }

  /* ---------- 5. Show messages + unread badge ---------- */
  function addMessage(m, initial) {
    if (shown[m.id]) return;
    shown[m.id] = true;
    const li = document.createElement("li");
    li.className = "chat-msg from-" + m.sender;
    const who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = m.sender === "admin" ? "Utsho: " : "You: ";
    const text = document.createElement("p");
    text.textContent = m.body; // textContent: never treat a message as HTML
    const time = document.createElement("time");
    time.dateTime = m.created_at;
    time.textContent = new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
    li.append(who, text, time);
    li.dataset.id = m.id;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
    if (m.sender === "admin") {
      if (!panel.hidden && !body.hidden) setSeen(m.id);
      else if (!initial) updateBadge();
    }
  }

  function markAllSeen() {
    log.querySelectorAll(".from-admin").forEach(function (li) { setSeen(parseInt(li.dataset.id, 10)); });
    updateBadge();
  }

  function updateBadge() {
    const seen = lastSeen();
    unread = Array.prototype.filter.call(log.querySelectorAll(".from-admin"), function (li) {
      return parseInt(li.dataset.id, 10) > seen;
    }).length;
    if (!panel.hidden && !body.hidden) unread = 0;
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    fabBtn.setAttribute("aria-label", unread
      ? "Contact us: chat, call or KakaoTalk – " + unread + " new " + (unread === 1 ? "reply" : "replies")
      : "Contact us: chat, call or KakaoTalk");
  }

  /* ---------- 6. Send: Enter sends, Shift+Enter = new line ---------- */
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { // isComposing: Korean input (IME) still typing
      e.preventDefault();
      sendForm.requestSubmit();
    }
  });

  sendForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !conv) return;
    if (text.length > 1000) { showError("Messages can be at most 1000 characters."); return; }
    if (Date.now() - lastSent < MIN_GAP_MS) { errorEl.textContent = "Please wait a moment before sending again."; return; }
    lastSent = Date.now();
    showError("");
    input.value = "";
    db.from("messages").insert({ conversation_id: conv.id, sender: "visitor", body: text })
      .select("id, created_at, sender, body").single()
      .then(function (res) {
        if (res.error) throw res.error;
        addMessage(res.data, false);
      })
      .catch(function (err) {
        console.error(err);
        input.value = text; // give the text back
        if (/closed/i.test(err.message || "")) { setClosed(true); return; }
        if (/Too many/i.test(err.message || "")) { errorEl.textContent = "Please wait a moment before sending again."; return; }
        showError("Sorry, your message could not be sent.");
      });
  });

  // returning visitor: connect quietly to show unread replies on the bubble
  if (HY_DB.hasSession() && stored()) connect(stored());
}
