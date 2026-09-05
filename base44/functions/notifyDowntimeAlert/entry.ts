// Legacy privileged automation intentionally retired. Active alert delivery is
// handled by authenticated Supabase workflows.
Deno.serve(() => Response.json(
  { error: 'LEGACY_HANDLER_DISABLED' },
  { status: 410 },
));
