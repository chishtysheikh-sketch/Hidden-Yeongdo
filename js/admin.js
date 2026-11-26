/* =========================================================
   Hidden Yeongdo – admin dashboard (admin.html)

   Log in with the admin email + password (Supabase Auth). The database
   only shows data to that account (Row Level Security), so even if
   someone opens this page they see nothing without the password.

   1. Helpers   2. Login / logout   3. Bookings   4. Questions
   5. Live chat (realtime, sound, browser notification)   6. CSV export
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  const $ = function (id) { return document.getElementById(id); };
  const msg = $("admin-msg");

  if (typeof HY_DB === "undefined" || !HY_DB.configured()) {
    msg.textContent = "Supabase is not set up yet: fill in SUPABASE_URL and SUPABASE_ANON_KEY in js/supabase.js.";
    return;
  }

  /* ---------- 1. Helpers ---------- */
  let db = null;
  const TOURS = { "1day": "1-Day Tour", sunset: "Sunset Walk", "private": "Private tour", question: "Question" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function when(iso) {
    return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
  }
  function won(n) { return n == null ? "" : "₩" + Number(n).toLocaleString("en-US"); }
  function flash(text, isError) {
    msg.textContent = text;
    msg.classList.toggle("is-error", Boolean(isError));
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { msg.textContent = ""; }, 4000);
  }
  function fail(err) { console.error(err); flash("Error: " + (err.message || err), true); }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const a = document.createElement("textarea");
    a.value = text; document.body.appendChild(a); a.select();
    try { document.execCommand("copy"); } finally { a.remove(); }
    return Promise.resolve();
  }

  /* ---------- 2. Login / logout ---------- */
  const loginForm = $("login-form");

  HY_DB.client("admin").then(function (c) {
    db = c;
    db.auth.onAuthStateChange(function (event, session) {
      // run outside the auth callback (supabase-js recommendation)
      setTimeout(function () { show(session); }, 0);
    });
  }).catch(fail);

  let started = false;
  function show(session) {
    const email = session && session.user && session.user.email;
    loginForm.hidden = Boolean(session);
    $("logout-btn").hidden = !session;
    $("no-access").hidden = !session || email === HY_DB.ADMIN_EMAIL;
    $("dashboard").hidden = !session || email !== HY_DB.ADMIN_EMAIL;
    $("notify-btn").hidden = $("dashboard").hidden || !("Notification" in window) || Notification.permission === "granted";
    if (session && email === HY_DB.ADMIN_EMAIL && !started) {
      started = true;
      openTabFromHash();
      loadBookings();
      loadQuestions();
      loadConversations();
      subscribeChat();
    }
    if (!session) {
      started = false;
      if (chatChannel) { db.removeChannel(chatChannel); chatChannel = null; }
    }
  }

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const err = $("login-error");
    err.textContent = "";
    unlockSound();
    db.auth.signInWithPassword({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value })
      .then(function (res) { if (res.error) err.textContent = res.error.message; else loginForm.reset(); });
  });
  $("logout-btn").addEventListener("click", function () { db.auth.signOut(); });

  // tabs: main.js part 10 switches the panels; here we keep the URL hash (#bookings, #questions, #chat)
  document.querySelectorAll(".admin-tabs .tab").forEach(function (tab) {
    tab.addEventListener("click", function () { history.replaceState(null, "", "#" + tab.dataset.hash); });
  });
  function openTabFromHash() {
    const tab = document.querySelector('.admin-tabs .tab[data-hash="' + location.hash.slice(1) + '"]');
    if (tab) tab.click();
  }

  /* ---------- 3. Bookings ---------- */
  let bookings = [];
  const STATUSES = ["new", "confirmed", "cancelled", "done"];

  function loadBookings() {
    db.from("bookings").select("*").order("created_at", { ascending: false }).then(function (res) {
      if (res.error) return fail(res.error);
      bookings = res.data;
      renderBookings();
    });
  }

  function renderBookings() {
    const filter = $("booking-filter").value;
    let rows = bookings.filter(function (b) { return filter === "all" || b.status === filter; });
    if ($("booking-sort").value === "tour") {
      rows = rows.slice().sort(function (a, b) { return String(a.tour_date || "9999").localeCompare(String(b.tour_date || "9999")); });
    }
    const n = bookings.filter(function (b) { return b.status === "new"; }).length;
    $("count-bookings").textContent = n ? n + " new" : "";

    $("booking-list").innerHTML = rows.length ? rows.map(function (b) {
      const guests = [b.adults && b.adults + " adult" + (b.adults > 1 ? "s" : ""), b.students && b.students + " student" + (b.students > 1 ? "s" : ""),
        b.children && b.children + " child" + (b.children > 1 ? "ren" : "")].filter(Boolean).join(", ");
      return '<article class="admin-card item status-' + esc(b.status) + '" data-id="' + b.id + '">' +
        '<div class="item-top"><strong>' + esc(b.name) + '</strong>' +
          '<span class="pill pill-' + esc(b.status) + '">' + esc(b.status) + '</span></div>' +
        '<p class="item-meta">' + esc(TOURS[b.tour] || b.tour) + (b.tour_date ? " · <strong>" + esc(b.tour_date) + "</strong>" : "") +
          (guests ? " · " + esc(guests) : "") + (b.estimated_total ? " · " + won(b.estimated_total) : "") + '</p>' +
        '<p class="item-contact"><a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' +
          (b.phone ? ' · <a href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">' + esc(b.phone) + '</a>' : "") +
          (b.kakao_id ? " · KakaoTalk: " + esc(b.kakao_id) : "") + '</p>' +
        (b.message ? '<p class="item-text">' + esc(b.message) + '</p>' : "") +
        '<p class="item-when">Received ' + when(b.created_at) + '</p>' +
        '<div class="item-actions">' +
          '<label>Status <select class="b-status">' + STATUSES.map(function (s) {
            return '<option' + (s === b.status ? " selected" : "") + ">" + s + "</option>";
          }).join("") + '</select></label>' +
          '<label class="grow">Note <textarea class="b-note" rows="1" maxlength="2000">' + esc(b.admin_note) + '</textarea></label>' +
          '<button type="button" class="btn btn-sm b-save-note">Save note</button>' +
        '</div></article>';
    }).join("") : '<p class="conv-empty">No bookings here yet.</p>';
  }

  function updateBooking(id, changes) {
    return db.from("bookings").update(changes).eq("id", id).then(function (res) {
      if (res.error) return fail(res.error);
      const b = bookings.find(function (x) { return x.id === id; });
      Object.assign(b, changes);
      renderBookings();
      flash("Saved.");
    });
  }

  $("booking-list").addEventListener("change", function (e) {
    if (!e.target.classList.contains("b-status")) return;
    updateBooking(parseInt(e.target.closest(".item").dataset.id, 10), { status: e.target.value });
  });
  $("booking-list").addEventListener("click", function (e) {
    if (!e.target.classList.contains("b-save-note")) return;
    const card = e.target.closest(".item");
    updateBooking(parseInt(card.dataset.id, 10), { admin_note: card.querySelector(".b-note").value.trim() || null });
  });
  $("booking-filter").addEventListener("change", renderBookings);
  $("booking-sort").addEventListener("change", renderBookings);
  $("booking-refresh").addEventListener("click", loadBookings);

  /* ---------- 4. Questions ---------- */
  let questions = [];

  function loadQuestions() {
    db.from("questions").select("*").order("created_at", { ascending: false }).then(function (res) {
      if (res.error) return fail(res.error);
      questions = res.data;
      renderQuestions();
    });
  }

  function renderQuestions() {
    const filter = $("question-filter").value;
    const rows = questions.filter(function (q) { return filter === "all" || q.status === filter; });
    const n = questions.filter(function (q) { return q.status === "new"; }).length;
    $("count-questions").textContent = n ? n + " new" : "";

    $("question-list").innerHTML = rows.length ? rows.map(function (q) {
      return '<article class="admin-card item status-' + esc(q.status) + '" data-id="' + q.id + '">' +
        '<div class="item-top"><strong>' + esc(q.name) + '</strong><span class="pill pill-' + esc(q.status) + '">' + esc(q.status) + '</span></div>' +
        '<p class="item-contact"><a href="mailto:' + esc(q.email) + '?subject=' + encodeURIComponent("Your question to Hidden Yeongdo") + '">' + esc(q.email) + '</a></p>' +
        '<p class="item-text">' + esc(q.question) + '</p>' +
        '<p class="item-when">Received ' + when(q.created_at) + '</p>' +
        '<label class="q-answer-label">Answer <textarea class="q-answer" rows="3" maxlength="4000">' + esc(q.answer) + '</textarea></label>' +
        '<div class="item-actions">' +
          '<button type="button" class="btn btn-sm q-save">Save answer</button>' +
          '<button type="button" class="btn btn-sm btn-ghost q-toggle">' + (q.status === "answered" ? "Mark as new" : "Mark answered") + '</button>' +
          '<button type="button" class="btn btn-sm btn-ghost q-faq">Copy as FAQ item</button>' +
        '</div></article>';
    }).join("") : '<p class="conv-empty">No questions here yet.</p>';
  }

  // ready-made HTML for faq.html (same structure as the other questions)
  function faqHtml(q, answer) {
    const n = 100 + q.id;
    return '          <li class="faq-item" id="faq-q' + q.id + '">\n' +
      '            <h3><button class="faq-q" type="button" aria-expanded="false" aria-controls="faq-a-' + n + '" id="faq-q-' + n + '"><span>' +
      esc(q.question) + '</span><span class="faq-arrow" aria-hidden="true">▾</span></button></h3>\n' +
      '            <div class="faq-a" id="faq-a-' + n + '" role="region" aria-labelledby="faq-q-' + n + '" hidden><p>' +
      esc(answer || "TODO: write the answer") + '</p></div>\n' +
      '          </li>\n';
  }

  $("question-list").addEventListener("click", function (e) {
    const card = e.target.closest(".item");
    if (!card) return;
    const id = parseInt(card.dataset.id, 10);
    const q = questions.find(function (x) { return x.id === id; });
    const answer = card.querySelector(".q-answer").value.trim();
    let changes = null;
    if (e.target.classList.contains("q-save")) changes = { answer: answer || null, status: answer ? "answered" : q.status };
    if (e.target.classList.contains("q-toggle")) changes = { status: q.status === "answered" ? "new" : "answered" };
    if (changes) {
      db.from("questions").update(changes).eq("id", id).then(function (res) {
        if (res.error) return fail(res.error);
        Object.assign(q, changes);
        renderQuestions();
        flash("Saved.");
      });
    }
    if (e.target.classList.contains("q-faq")) {
      copyText(faqHtml(q, answer)).then(function () {
        flash("FAQ HTML copied: paste it into the list in faq.html (and add it to the FAQPage JSON-LD).");
      }, fail);
    }
  });
  $("question-filter").addEventListener("change", renderQuestions);
  $("question-refresh").addEventListener("click", loadQuestions);

  /* ---------- 5. Live chat ---------- */
  let convs = [];
  let current = null; // open conversation id
  let chatChannel = null;
  const shown = {};

  function loadConversations() {
    return db.from("conversations").select("*")
      .order("unread_by_admin", { ascending: false }).order("last_message_at", { ascending: false })
      .then(function (res) {
        if (res.error) return fail(res.error);
        convs = res.data;
        renderConversations();
      });
  }

  function sortConvs() {
    convs.sort(function (a, b) {
      if (a.unread_by_admin !== b.unread_by_admin) return a.unread_by_admin ? -1 : 1;
      return String(b.last_message_at).localeCompare(String(a.last_message_at));
    });
  }

  function renderConversations() {
    sortConvs();
    const n = convs.filter(function (c) { return c.unread_by_admin; }).length;
    $("count-chat").textContent = n ? n + " unread" : "";
    document.title = (n ? "(" + n + ") " : "") + "Admin | Hidden Yeongdo";
    $("conv-list").innerHTML = convs.length ? convs.map(function (c) {
      return '<li><button type="button" class="conv-item' + (c.id === current ? " active" : "") + (c.unread_by_admin ? " unread" : "") +
        (c.status === "closed" ? " closed" : "") + '" data-id="' + esc(c.id) + '">' +
        '<span class="conv-name">' + (c.unread_by_admin ? '<span class="dot" aria-label="unread"></span>' : "") + esc(c.visitor_name) + '</span>' +
        '<span class="conv-time">' + when(c.last_message_at) + (c.status === "closed" ? " · closed" : "") + '</span></button></li>';
    }).join("") : '<li class="conv-empty">No chats yet.</li>';
  }

  function openConversation(id) {
    current = id;
    const c = convs.find(function (x) { return x.id === id; });
    if (!c) return;
    $("conv-view").hidden = false;
    $("conv-empty").hidden = true;
    document.querySelector(".chat-admin").classList.add("viewing");
    $("conv-who").innerHTML = "<strong>" + esc(c.visitor_name) + "</strong>" +
      (c.visitor_email ? '<br><a href="mailto:' + esc(c.visitor_email) + '">' + esc(c.visitor_email) + "</a>" : "<br><span class=\"opt\">no email given</span>");
    $("conv-close").textContent = c.status === "closed" ? "Closed" : "Close chat";
    $("conv-close").disabled = c.status === "closed";
    $("admin-send").hidden = c.status === "closed";
    $("admin-log").innerHTML = "";
    Object.keys(shown).forEach(function (k) { delete shown[k]; });
    db.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }).then(function (res) {
      if (res.error) return fail(res.error);
      res.data.forEach(addMessage);
    });
    if (c.unread_by_admin) {
      c.unread_by_admin = false;
      db.from("conversations").update({ unread_by_admin: false }).eq("id", id).then(function (res) { if (res.error) fail(res.error); });
    }
    renderConversations();
    if (c.status === "open") $("admin-input").focus();
  }

  function addMessage(m) {
    if (shown[m.id]) return;
    shown[m.id] = true;
    const li = document.createElement("li");
    li.className = "chat-msg " + (m.sender === "admin" ? "from-visitor" : "from-admin"); // admin's own messages on the right
    const who = document.createElement("span");
    who.className = "sr-only";
    who.textContent = m.sender === "admin" ? "You: " : "Visitor: ";
    const p = document.createElement("p");
    p.textContent = m.body;
    const t = document.createElement("time");
    t.dateTime = m.created_at;
    t.textContent = when(m.created_at);
    li.append(who, p, t);
    const log = $("admin-log");
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  $("conv-list").addEventListener("click", function (e) {
    const b = e.target.closest(".conv-item");
    if (b) openConversation(b.dataset.id);
  });
  $("conv-back").addEventListener("click", function () {
    document.querySelector(".chat-admin").classList.remove("viewing");
    current = null;
    $("conv-view").hidden = true;
    $("conv-empty").hidden = false;
    renderConversations();
  });
  $("conv-close").addEventListener("click", function () {
    if (!current || !confirm("Close this chat? The visitor can start a new one.")) return;
    db.from("conversations").update({ status: "closed" }).eq("id", current).then(function (res) {
      if (res.error) return fail(res.error);
      const c = convs.find(function (x) { return x.id === current; });
      c.status = "closed";
      openConversation(current);
    });
  });

  const input = $("admin-input");
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("admin-send").requestSubmit(); }
  });
  $("admin-send").addEventListener("submit", function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !current) return;
    input.value = "";
    $("admin-chat-error").textContent = "";
    db.from("messages").insert({ conversation_id: current, sender: "admin", body: text }).select().single().then(function (res) {
      if (res.error) { input.value = text; $("admin-chat-error").textContent = "Not sent: " + res.error.message; return; }
      addMessage(res.data);
    });
  });

  // realtime: new chats, new messages, unread changes
  function subscribeChat() {
    chatChannel = db.channel("admin-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, function (p) {
        const row = p.new;
        const i = convs.findIndex(function (c) { return c.id === (row && row.id) || c.id === (p.old && p.old.id); });
        if (p.eventType === "DELETE") { if (i > -1) convs.splice(i, 1); }
        else if (i > -1) convs[i] = Object.assign(convs[i], row, current === row.id ? { unread_by_admin: false } : {});
        else convs.push(row);
        renderConversations();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, function (p) {
        const m = p.new;
        if (m.conversation_id === current) {
          addMessage(m);
          if (m.sender === "visitor") db.from("conversations").update({ unread_by_admin: false }).eq("id", current);
        }
        if (m.sender === "visitor" && (m.conversation_id !== current || document.hidden)) alertNewMessage(m);
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") loadConversations(); // catch up after a reconnect
      });
  }

  // soft "ding" (no sound file needed) + browser notification
  let audio = null;
  function unlockSound() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { audio = null; }
  }
  document.addEventListener("click", unlockSound, { once: true });
  function ding() {
    if (!audio) return;
    [660, 880].forEach(function (freq, i) {
      const o = audio.createOscillator(), g = audio.createGain();
      const t = audio.currentTime + i * 0.15;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.4);
    });
  }
  function alertNewMessage(m) {
    ding();
    const c = convs.find(function (x) { return x.id === m.conversation_id; });
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification("New chat message" + (c ? " from " + c.visitor_name : ""), {
        body: m.body.slice(0, 120), tag: "hy-chat-" + m.conversation_id, icon: "images/favicon.svg"
      });
      n.onclick = function () { window.focus(); $("tab-chat").click(); openConversation(m.conversation_id); n.close(); };
    }
  }
  $("notify-btn").addEventListener("click", function () {
    unlockSound();
    Notification.requestPermission().then(function (p) {
      $("notify-btn").hidden = p === "granted";
      flash(p === "granted" ? "Notifications on (while this page is open)." : "Notifications are blocked in the browser settings.", p !== "granted");
    });
  });

  /* ---------- 6. CSV export (backup) ---------- */
  function downloadCsv(name, rows) {
    if (!rows.length) return flash("Nothing to export.");
    const cols = Object.keys(rows[0]);
    const cell = function (v) {
      let s = String(v == null ? "" : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // visitor text must never run as an Excel formula
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = "﻿" + [cols.join(",")].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(","); })).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  $("booking-csv").addEventListener("click", function () { downloadCsv("bookings", bookings); });
  $("question-csv").addEventListener("click", function () { downloadCsv("questions", questions); });
});
