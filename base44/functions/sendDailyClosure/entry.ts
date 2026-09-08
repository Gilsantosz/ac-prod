// Legacy unauthenticated mail handler intentionally retired. The current
// Supabase sendDailyClosure function validates JWT, active profile and capability.
Deno.serve(() => Response.json(
  { error: 'LEGACY_HANDLER_DISABLED' },
  { status: 410 },
));
