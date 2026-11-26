/* =========================================================
   Hidden Yeongdo – main script (vanilla JavaScript, no libraries
   except Leaflet for the map on gallery.html)

   Every feature first checks if its element exists on the page,
   so this one file can be loaded on all six pages.
   1. Mobile menu   2. (removed)   3. Footer year
   4. Accordions (timeline stops + FAQ)   5. Gallery filter   6. Lightbox
   7. OpenStreetMap   8. Forms: shared validation + sending (Supabase,
      Formspree as fallback), booking form, "Ask your own question" form   9. Sunset time
   10. Trip overview tabs   11. Day / night mode
   12. Copy KakaoTalk ID + floating contact button
   13. Approx. USD prices   14. FAQ search
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
  setupTheme();
  setupMenu();
  setupYear();
  setupTimeline();
  setupFaq();
  setupGalleryFilter();
  setupLightbox();
  setupMap();
  setupContactForm();
  setupQuestionForm();
  setupSunset();
  setupTabs();
  setupCopyButtons();
  setupFloatingContact();
  setupUsdPrices();
  setupFaqSearch();
});

/* ---------- 1. Mobile menu (☰ button) ---------- */
function setupMenu() {
  const btn = document.querySelector(".menu-btn");
  const links = document.querySelector(".nav-links");
  if (!btn || !links) return;

  btn.addEventListener("click", function () {
    links.classList.toggle("open");
    // tell screen readers whether the menu is open
    btn.setAttribute("aria-expanded", links.classList.contains("open"));
  });
}

/* ---------- 3. Footer year ---------- */
function setupYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
}

/* ---------- 4. Accordions ----------
   Timeline stops (packages page) and FAQ questions (faq.html, home page).
   They are <button>s, so Enter / Space / Tab work without extra code. */
function setupTimeline() {
  document.querySelectorAll(".stop-toggle").forEach(function (button) {
    button.addEventListener("click", function () {
      const stop = button.parentElement;
      stop.classList.toggle("open");
      button.setAttribute("aria-expanded", stop.classList.contains("open"));
    });
  });
}

function setupFaq() {
  function toggle(item, open) {
    const button = item.querySelector(".faq-q");
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    item.classList.toggle("open", open);
    button.setAttribute("aria-expanded", open);
    panel.hidden = !open;
  }
  document.querySelectorAll(".faq-item").forEach(function (item) {
    item.querySelector(".faq-q").addEventListener("click", function () {
      toggle(item, !item.classList.contains("open"));
    });
  });
  // a link like faq.html#faq-rain opens that question
  function openFromHash() {
    let target = null;
    try { target = location.hash && document.querySelector(".faq-item" + location.hash); } catch (e) { /* not a valid id */ }
    if (target) toggle(target, true);
  }
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
}

/* ---------- 5. Gallery filter buttons ---------- */
function setupGalleryFilter() {
  const buttons = document.querySelectorAll(".filter-btn");
  const items = document.querySelectorAll(".gallery-item");
  if (!buttons.length) return;

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      buttons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");

      const filter = btn.dataset.filter; // "all", "coast", "mountain", "beach"
      items.forEach(function (item) {
        const show = filter === "all" || item.dataset.place === filter;
        item.classList.toggle("hide", !show);
      });
    });
  });
}

/* ---------- 6. Lightbox (full-screen photo viewer) ---------- */
function setupLightbox() {
  const box = document.querySelector(".lightbox");
  if (!box) return;
  const img = box.querySelector("img");
  const caption = box.querySelector("p");
  let current = 0;

  // only the photos that are visible right now (after filtering)
  function visibleItems() {
    return Array.from(document.querySelectorAll(".gallery-item:not(.hide)"));
  }

  function show(index) {
    const items = visibleItems();
    current = (index + items.length) % items.length; // wrap around
    const photo = items[current].querySelector("img");
    img.src = photo.src;
    img.alt = photo.alt;
    caption.textContent = photo.alt;
  }

  document.querySelectorAll(".gallery-item").forEach(function (item) {
    item.addEventListener("click", function () {
      show(visibleItems().indexOf(item));
      box.classList.add("open");
    });
  });

  box.querySelector(".lb-close").addEventListener("click", close);
  box.querySelector(".lb-prev").addEventListener("click", function () { show(current - 1); });
  box.querySelector(".lb-next").addEventListener("click", function () { show(current + 1); });
  box.addEventListener("click", function (e) { if (e.target === box) close(); });

  // keyboard: Esc closes, arrows move
  document.addEventListener("keydown", function (e) {
    if (!box.classList.contains("open")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") show(current - 1);
    if (e.key === "ArrowRight") show(current + 1);
  });

  function close() { box.classList.remove("open"); }
}

/* ---------- 7. OpenStreetMap with Leaflet ----------
   Leaflet is loaded from a CDN in gallery.html.
   Coordinates are approximate: check them on openstreetmap.org. */
function setupMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const places = [
    { name: "Jeoryeong Coastal Walk", lat: 35.0752, lng: 129.0457, text: "3 km cliff-side sea walk" },
    { name: "Bongnaesan Mountain", lat: 35.0789, lng: 129.0573, text: "395 m guardian peak of Yeongdo" },
    { name: "Gamji Beach", lat: 35.0620, lng: 129.0850, text: "Pebble beach for sunset and grilled clams" }
  ];

  const map = L.map("map").setView([35.072, 129.063], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  places.forEach(function (p) {
    L.marker([p.lat, p.lng]).addTo(map).bindPopup("<b>" + p.name + "</b><br>" + p.text);
  });
}

/* ---------- 8. Forms (booking form + "Ask your own question") ----------
   Both forms are saved in the Supabase database (js/supabase.js); an Edge
   Function then emails the admin. If Supabase is not set up yet, the form
   is sent to Formspree instead (when a Formspree ID is filled in). */

const CONTACT_FALLBACK = 'Please call <a href="tel:+821043294220">010-4329-4220</a>, ' +
  "send a KakaoTalk message to ID <strong>chishty</strong> or email " +
  '<a href="mailto:chishtysheikh@gmail.com">chishtysheikh@gmail.com</a>.';

const isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); };

// Shared validation. rules = { key: function (value, field) -> true or "error text" }
// Each key needs a field (form.elements[fieldName]) and an element with id prefix + key + "-error".
// fields maps a rule key to its field name when they differ (e.g. ask-form uses "question").
function createValidator(form, rules, prefix, fields) {
  fields = fields || {};
  function field(key) { return form.elements[fields[key] || key]; }
  function check(key) {
    const f = field(key);
    const value = f ? (f.type === "checkbox" ? f.checked : f.value) : "";
    const result = rules[key](value, f);
    const ok = result === true;
    if (f) {
      f.classList.toggle("invalid", !ok);
      f.setAttribute("aria-invalid", !ok);
    }
    document.getElementById(prefix + key + "-error").textContent = ok ? "" : result;
    return ok;
  }
  function checkAll() {
    let allOk = true;
    Object.keys(rules).forEach(function (key) { if (!check(key)) allOk = false; });
    if (!allOk) {
      const firstBad = form.querySelector(".invalid");
      if (firstBad) firstBad.focus();
    }
    return allOk;
  }
  // live feedback when the user leaves a field
  Object.keys(rules).forEach(function (key) {
    const f = field(key);
    if (f && f.addEventListener) f.addEventListener(f.type === "checkbox" ? "change" : "blur", function () { check(key); });
  });
  return { check: check, checkAll: checkAll };
}

// Shared sending. Shows the success text only when the database (or Formspree) says ok.
// opts: { table, row, status, successText(), onSuccess() }
function submitForm(form, opts) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  const status = opts.status;

  function finish(ok) {
    if (ok) {
      status.classList.remove("is-error");
      status.textContent = opts.successText();
      form.reset();
      if (opts.onSuccess) opts.onSuccess();
    } else {
      status.classList.add("is-error");
      status.innerHTML = "Sorry, your message could not be sent. " + CONTACT_FALLBACK;
    }
    status.classList.add("show");
    button.disabled = false;
    button.textContent = label;
  }

  // spam trap filled in (only bots see this field): pretend it worked, send nothing
  if (form.elements._gotcha && form.elements._gotcha.value) { finish(true); return; }

  button.disabled = true;
  button.textContent = "Sending…";
  status.classList.remove("show", "is-error");

  let sending;
  if (typeof HY_DB !== "undefined" && HY_DB.configured()) {
    sending = HY_DB.client().then(function (db) {
      // no .select(): visitors may write a row but never read it back
      return db.from(opts.table).insert(opts.row);
    }).then(function (res) {
      if (res.error) throw res.error;
    });
  } else if (form.action.indexOf("{{") === -1 && form.action.indexOf("formspree.io/f/") !== -1) {
    sending = fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
      .then(function (res) { if (!res.ok) throw new Error("Form service error " + res.status); });
  } else {
    sending = Promise.reject(new Error("No form service set up"));
  }
  sending.then(function () { finish(true); }, function (err) {
    console.error(err);
    finish(false);
  });
}

// Booking form (contact.html)
function setupContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const MAX_GUESTS = 10;
  const isBooking = function () { return ["1day", "sunset", "private"].indexOf(form.elements.package.value) !== -1; };
  const guestCount = function () {
    return ["adults", "students", "children"].reduce(function (sum, n) {
      return sum + (parseInt(form.elements[n].value, 10) || 0);
    }, 0);
  };

  // ?package=sunset in the URL (from the "Book" buttons) preselects the tour
  const wanted = new URLSearchParams(location.search).get("package");
  if (wanted && form.querySelector('#package option[value="' + wanted + '"]')) form.elements.package.value = wanted;

  // no bookings in the past: earliest date is tomorrow (Korean time)
  const tomorrow = new Date(Date.now() + 9 * 3600e3 + 24 * 3600e3).toISOString().slice(0, 10);
  form.elements.date.min = tomorrow;

  const validator = createValidator(form, {
    name: function (v) { return v.trim().length >= 2 || "Please enter your name (2+ letters)."; },
    email: function (v) { return isEmail(v) || "Please enter a valid email."; },
    package: function (v) { return v !== "" || "Please choose a tour."; },
    date: function (v) {
      if (!isBooking()) return true;
      if (!v) return "Please choose a preferred date.";
      if (v < tomorrow) return "Please choose a date from tomorrow onwards.";
      const day = new Date(v + "T12:00:00Z").getUTCDay(); // 0 = Sunday, 6 = Saturday
      if (form.elements.package.value !== "private" && day !== 0 && day !== 6) {
        return "Tours run on Saturdays and Sundays. For another day, choose a private tour.";
      }
      return true;
    },
    guests: function () {
      if (!isBooking()) return true;
      const n = guestCount();
      if (n < 1) return "Please add at least one guest.";
      return n <= MAX_GUESTS || "A tour takes up to " + MAX_GUESTS + " guests. For bigger groups, choose a private tour or message us.";
    },
    message: function (v) { return isBooking() || v.trim().length >= 10 || "Please write your question (10+ characters)."; },
    consent: function (checked) { return checked || "Please tick the box so we may contact you about your booking."; }
  }, "");

  // live estimated total from the prices stored on the form (data-price-*)
  const estimate = document.getElementById("price-estimate");
  function price(key) { return parseInt(form.dataset["price" + key], 10); }
  function updateEstimate() {
    const pkg = form.elements.package.value;
    const n = { a: parseInt(form.elements.adults.value, 10) || 0, s: parseInt(form.elements.students.value, 10) || 0, c: parseInt(form.elements.children.value, 10) || 0 };
    let total = NaN;
    if (pkg === "1day") total = n.a * price("Adult") + n.s * price("Student") + n.c * price("Child");
    if (pkg === "sunset") total = (n.a + n.s + n.c) * price("Sunset"); // empty until the sunset price is set
    if (isNaN(total) || total <= 0) {
      estimate.textContent = "";
    } else {
      estimate.innerHTML = "Estimated total: ₩" + total.toLocaleString("en-US") +
        ' <span class="estimate-note">· Final price confirmed by email</span>';
    }
  }
  ["adults", "students", "children"].forEach(function (name) {
    form.elements[name].addEventListener("input", function () { updateEstimate(); validator.check("guests"); });
  });
  form.elements.package.addEventListener("change", function () {
    updateEstimate(); validator.check("date"); validator.check("guests");
  });
  updateEstimate();

  form.addEventListener("submit", function (e) {
    e.preventDefault(); // send with fetch instead of reloading the page
    if (!validator.checkAll()) return;
    const f = form.elements;
    const name = f.name.value.trim();
    const email = f.email.value.trim();
    const total = parseInt((estimate.textContent.match(/₩([\d,]+)/) || ["", ""])[1].replace(/,/g, ""), 10);
    const n = function (field) { return Math.max(0, parseInt(field.value, 10) || 0); };
    submitForm(form, {
      table: "bookings",
      row: {
        name: name, email: email,
        phone: f.phone.value.trim() || null,
        kakao_id: f.kakao_id.value.trim() || null,
        tour: f.package.value,
        tour_date: f.date.value || null,
        adults: n(f.adults), students: n(f.students), children: n(f.children),
        estimated_total: isNaN(total) ? null : total,
        message: f.message.value.trim() || null,
        consent: f.consent.checked
      },
      status: document.getElementById("form-success"),
      successText: function () { return "Thank you, " + name + "! Your request has been sent. We will reply to " + email + " within 24 hours."; },
      onSuccess: updateEstimate
    });
  });
}

// "Ask your own question" (faq.html)
function setupQuestionForm() {
  const form = document.getElementById("ask-form");
  if (!form) return;

  const validator = createValidator(form, {
    name: function (v) { return v.trim().length >= 2 || "Please enter your name (2+ letters)."; },
    email: function (v) { return isEmail(v) || "Please enter a valid email."; },
    question: function (v) { return v.trim().length >= 10 || "Please write your question (10+ characters)."; },
    consent: function (checked) { return checked || "Please tick the box so we may answer you by email."; }
  }, "ask-");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validator.checkAll()) return;
    const f = form.elements;
    const email = f.email.value.trim();
    submitForm(form, {
      table: "questions",
      row: { name: f.name.value.trim(), email: email, question: f.question.value.trim(), consent: f.consent.checked },
      status: document.getElementById("ask-success"),
      successText: function () { return "Thank you! Your question has been sent. We will answer you at " + email + " within 24 hours."; }
    });
  });
}

/* ---------- 9. Today's sunset time (free API, no key needed) ----------
   https://sunrise-sunset.org/api – returns UTC time, we show it in Korean time. */
function setupSunset() {
  const el = document.getElementById("sunset-time");
  if (!el) return;

  fetch("https://api.sunrise-sunset.org/json?lat=35.0620&lng=129.0850&formatted=0")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      const sunset = new Date(data.results.sunset);
      el.textContent = sunset.toLocaleTimeString("ko-KR", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul"
      });
    })
    .catch(function () {
      el.textContent = "around 17:20"; // fallback if the API cannot be reached
    });
}

/* ---------- 10. Trip overview tabs (home page) ----------
   Clicking a tab shows its panel and hides the others. */
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  if (!tabs.length) return;

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
        document.getElementById(t.getAttribute("aria-controls")).classList.remove("active");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(tab.getAttribute("aria-controls")).classList.add("active");
    });
  });
}

/* ---------- 11. Day / night mode ----------
   The tiny script in each page's <head> already set data-theme on <html>
   (saved choice, or the system setting on a first visit). This part
   updates the button and saves the user's choice. */
function setupTheme() {
  const root = document.documentElement;
  const btn = document.querySelector(".theme-btn");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function saved() {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  }

  function apply(theme, animate) {
    if (animate && !reduceMotion.matches) {
      root.classList.add("theme-anim"); // smooth 0.3 s colour change (css part 14)
      setTimeout(function () { root.classList.remove("theme-anim"); }, 400);
    }
    root.setAttribute("data-theme", theme);
    if (!btn) return;
    const night = theme === "night";
    btn.textContent = night ? "☀️" : "🌙";
    btn.setAttribute("aria-pressed", night);
    btn.setAttribute("aria-label", night ? "Switch to day mode" : "Switch to night mode");
  }

  apply(root.getAttribute("data-theme") === "night" ? "night" : "day", false);
  if (!btn) return;

  btn.addEventListener("click", function () {
    const next = root.getAttribute("data-theme") === "night" ? "day" : "night";
    apply(next, true);
    try { localStorage.setItem("theme", next); } catch (e) { /* private mode: works for this page only */ }
  });

  // no saved choice yet: follow the system setting when it changes
  if (systemDark.addEventListener) {
    systemDark.addEventListener("change", function (e) {
      if (saved() !== "day" && saved() !== "night") apply(e.matches ? "night" : "day", true);
    });
  }
  // the choice was changed in another tab
  window.addEventListener("storage", function (e) {
    if (e.key === "theme" && (e.newValue === "day" || e.newValue === "night")) apply(e.newValue, true);
  });
}

/* ---------- 12. Copy KakaoTalk ID + floating contact button ---------- */
function setupCopyButtons() {
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const text = btn.dataset.copy;
    function done() {
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = "Copy ID"; btn.classList.remove("copied"); }, 2000);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) && done(); });
    } else if (fallbackCopy(text)) {
      done();
    }
  });

  // older browsers / http: copy through a hidden text field
  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }
}

function setupFloatingContact() {
  const btn = document.querySelector(".fab-btn");
  const menu = document.getElementById("fab-menu");
  if (!btn || !menu) return;

  const icon = btn.querySelector(".fab-icon");
  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    icon.textContent = open ? "✕" : "💬"; // the unread badge next to the icon stays (js/chat.js)
  }
  btn.addEventListener("click", function () { setOpen(menu.hidden); });
  document.addEventListener("hy-fab-close", function () { setOpen(false); }); // sent by js/chat.js
  // Esc or a click outside closes the menu
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) { setOpen(false); btn.focus(); }
  });
  document.addEventListener("click", function (e) {
    if (!menu.hidden && !e.target.closest(".fab")) setOpen(false);
  });
}

/* ---------- 13. Approx. USD prices (packages page) ---------- */
// update this rate: Korean won per 1 US dollar (check e.g. on xe.com)
const KRW_PER_USD = 1400; // TODO: update this rate before you publish

function setupUsdPrices() {
  document.querySelectorAll(".usd[data-krw]").forEach(function (el) {
    const usd = Math.round(parseInt(el.dataset.krw, 10) / KRW_PER_USD);
    el.textContent = "approx. US$" + usd;
  });
}

/* ---------- 14. FAQ search: filter the questions as you type ---------- */
function setupFaqSearch() {
  const input = document.getElementById("faq-search");
  if (!input) return;
  const items = document.querySelectorAll("#faq-list .faq-item");
  const empty = document.getElementById("faq-empty");

  input.addEventListener("input", function () {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    items.forEach(function (item) {
      const text = item.textContent.toLowerCase();
      const match = words.every(function (w) { return text.indexOf(w) !== -1; });
      item.classList.toggle("hide", !match);
      if (match) shown++;
    });
    empty.textContent = shown ? "" : "No questions match. Ask us below and we will answer by email.";
  });
}
