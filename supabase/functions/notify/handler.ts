// Hidden Yeongdo – "notify" Edge Function: the logic (index.ts starts the server).
// Emails the admin (via Resend) when a booking, a question or a chat message
// arrives. It is called by three Supabase Database Webhooks (INSERT on
// bookings, questions and messages) – see README → "Email notifications".
//
// Secrets (set with `supabase secrets set …`, never in the website or repo):
//   RESEND_API_KEY   – from resend.com
//   WEBHOOK_SECRET   – any long random string; the webhooks send it in the
//                      "x-webhook-secret" header so nobody else can call this
//   ADMIN_URL        – link to admin.html on your site
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const ADMIN_EMAIL = "chishtysheikh@gmail.com";
const FROM = "Hidden Yeongdo <onboarding@resend.dev>"; // Resend's test sender: only delivers to your own Resend account email

type Row = Record<string, unknown>;
type Payload = { type: string; table: string; record: Row | null };
type Env = (name: string) => string | undefined;

const TOURS: Record<string, string> = {
  "1day": "1-Day Hidden Yeongdo Tour",
  sunset: "Half-day Sunset Walk",
  private: "Private group tour",
  question: "Just a question",
};

// everything a visitor typed is escaped before it goes into the email HTML
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function table(rows: [string, unknown][]): string {
  return "<table cellpadding='6' style='border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px'>" +
    rows.filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `<tr><td style='color:#5e6e78;vertical-align:top'>${esc(k)}</td><td>${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
      .join("") +
    "</table>";
}

function button(url: string, label: string): string {
  return `<p style="margin-top:20px"><a href="${esc(url)}" style="background:#b4472e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-family:Arial,sans-serif">${esc(label)}</a></p>`;
}

// fetch the chat's conversation row with the service role (bypasses RLS, server-side only)
async function getConversation(id: unknown, env: Env, fetcher: typeof fetch): Promise<Row | null> {
  const url = `${env("SUPABASE_URL")}/rest/v1/conversations?id=eq.${encodeURIComponent(String(id))}&select=*`;
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetcher(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function countMessages(conversationId: unknown, env: Env, fetcher: typeof fetch): Promise<number> {
  const url = `${env("SUPABASE_URL")}/rest/v1/messages?conversation_id=eq.${encodeURIComponent(String(conversationId))}&select=id&limit=2`;
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetcher(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) return 1;
  return (await res.json()).length;
}

export async function buildEmail(p: Payload, env: Env, fetcher: typeof fetch) {
  const r = p.record ?? {};
  const admin = env("ADMIN_URL") ?? "";

  if (p.table === "bookings") {
    const guests = `${r.adults ?? 0} adults, ${r.students ?? 0} students, ${r.children ?? 0} children`;
    return {
      subject: `New booking: ${TOURS[String(r.tour)] ?? r.tour} – ${r.tour_date ?? "no date"} – ${r.name}`,
      reply_to: String(r.email ?? ""),
      html: `<h2 style="font-family:Georgia,serif">New booking request</h2>` + table([
        ["Name", r.name], ["Email", r.email], ["Phone / WhatsApp", r.phone], ["KakaoTalk", r.kakao_id],
        ["Tour", TOURS[String(r.tour)] ?? r.tour], ["Date", r.tour_date], ["Guests", guests],
        ["Estimated total", r.estimated_total ? `₩${Number(r.estimated_total).toLocaleString("en-US")}` : ""],
        ["Message", r.message],
      ]) + button(admin + "#bookings", "Open in admin"),
    };
  }

  if (p.table === "questions") {
    return {
      subject: `New question from ${r.name}`,
      reply_to: String(r.email ?? ""),
      html: `<h2 style="font-family:Georgia,serif">New question from the website</h2>` + table([
        ["Name", r.name], ["Email", r.email], ["Question", r.question],
      ]) + button(admin + "#questions", "Answer in admin"),
    };
  }

  if (p.table === "messages") {
    // the database decides (messages.notify_admin): first message of a chat,
    // or a message while the chat has been unread for 10+ minutes
    if (r.sender !== "visitor" || r.notify_admin !== true) return null;
    const conv = await getConversation(r.conversation_id, env, fetcher);
    const name = conv?.visitor_name ?? "A visitor";
    // more than one message in the chat = this is a "still unread" reminder
    const reminder = (await countMessages(r.conversation_id, env, fetcher)) > 1;
    return {
      subject: reminder ? `Unread chat from ${name} (10+ min)` : `New live chat from ${name}`,
      reply_to: conv?.visitor_email ? String(conv.visitor_email) : undefined,
      html: `<h2 style="font-family:Georgia,serif">${reminder ? "A chat is waiting for your reply" : "New live chat"}</h2>` + table([
        ["Name", name], ["Email", conv?.visitor_email ?? "(not given)"], ["Message", r.body],
      ]) + button(admin + "#chat", "Reply in admin"),
    };
  }
  return null;
}

export async function handler(req: Request, env: Env = Deno.env.get.bind(Deno.env), fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = env("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (payload.type !== "INSERT") return new Response("ignored", { status: 200 });

  const email = await buildEmail(payload, env, fetcher);
  if (!email) return new Response("no email needed", { status: 200 });

  const res = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [ADMIN_EMAIL], ...email }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    return new Response("email failed", { status: 502 });
  }
  return new Response("sent", { status: 200 });
}

