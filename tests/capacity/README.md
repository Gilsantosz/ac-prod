# AC.Prod2 capacity tests

The production-like test environment uses a triple safety lock: exact project URL,
`K6_TARGET=test-production`, and the confirmation phrase enforced by
`tests/load/collection-fabric-v3.js`. Every run uses a 32-character `CAPTEST_...`
identifier. Credentials and session tokens are written only below a private temp
directory with mode `0600`; they must never be committed or copied into reports.

1. Generate the seed SQL with `node tests/capacity/seed-capacity-fixture.mjs <run_id> 500`.
2. Apply that generated SQL with the linked Supabase CLI.
3. Pipe `supabase projects api-keys --reveal --output json` into
   `prepare-auth-fixture.mjs`; this keeps the server key out of files and logs.
4. Run smoke, contention, route, burst and endurance profiles with k6.
5. Reconcile before cleanup. Archive the anonymized metrics only.
6. Pipe the API key list into `cleanup-capacity-fixture.mjs`, invoke
   `cleanup_capacity_fixture_v3`, then reconcile again.

The browser administration page only requests/pauses/stops runs. It never holds a
server key and does not generate load itself.
