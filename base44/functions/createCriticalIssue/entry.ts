// Legacy shared GitHub connector endpoint intentionally retired. GitHub writes
// must use an explicitly authorized, repository-bound integration.
Deno.serve(() => Response.json(
  { error: 'LEGACY_HANDLER_DISABLED' },
  { status: 410 },
));
