// Legacy Base44 endpoint intentionally retired. Synchronization now goes
// through Supabase APIs with caller RLS; no request path may obtain service_role.
Deno.serve(() => Response.json(
  { error: 'LEGACY_HANDLER_DISABLED' },
  { status: 410 },
));
