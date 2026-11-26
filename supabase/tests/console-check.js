/* Security check for the LIVE site (after setup).
   Open any page of your site, press F12 → Console, paste this whole file, Enter.
   It uses only the public anon key – exactly what a stranger has.
   Expected: every line says BLOCKED or shows an empty list [].
   (It creates one anonymous chat login in your project; harmless.) */
(async () => {
  const db = await HY_DB.client();
  const show = (label, r) => console.log(label.padEnd(42), r.error ? "BLOCKED: " + r.error.message : r.data);
  show("read bookings (not signed in)", await db.from("bookings").select("*"));
  show("read questions (not signed in)", await db.from("questions").select("*"));
  await db.auth.signInAnonymously();
  show("read bookings (anonymous login)", await db.from("bookings").select("*"));
  show("read questions (anonymous login)", await db.from("questions").select("*"));
  show("read other people's chats", await db.from("conversations").select("*"));
  show("read other people's messages", await db.from("messages").select("*"));
  show("change a booking (0 rows = blocked)", await db.from("bookings").update({ status: "cancelled" }).gte("id", 0).select());
  show("write a message as 'admin'", await db.from("messages").insert({ conversation_id: "00000000-0000-0000-0000-000000000000", sender: "admin", body: "x" }));
  show("set booking status myself", await db.from("bookings").insert({ name: "Test", email: "t@example.com", tour: "1day", consent: true, status: "confirmed" }));
  await db.auth.signOut();
})();
