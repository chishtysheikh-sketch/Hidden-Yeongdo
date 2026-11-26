// Hidden Yeongdo – "notify" Edge Function (entry point).
// The logic is in handler.ts (so it can be tested without starting a server).
// Deploy: npx supabase functions deploy notify --no-verify-jwt   – see README → "Backend setup".
import { handler } from "./handler.ts";

Deno.serve((req) => handler(req));
