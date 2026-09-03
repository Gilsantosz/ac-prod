# AC.Prod2 capacity tests

The production-like test environment uses a triple safety lock: exact project URL,
`K6_TARGET=test-production`, and the confirmation phrase enforced by
`tests/load/collection-fabric-v3.js`. Every run uses a 32-character `CAPTEST_...`
identifier. Credentials and session tokens are written only below a private temp
directory with mode `0600`; they must never be committed or copied into reports.

1. Generate the seed SQL with `node tests/capacity/seed-capacity-fixture.mjs <run_id> 500`.
2. Apply that generated SQL with the linked Supabase CLI.
3. Pipe `supabase projects api-keys --reveal --output json` into
   `prepare-auth-fixture.mjs`; this keeps the server key out of files and logs. The
   script also calls `prepare_capacity_atomic_contexts_v3` so all eight selected
   operators are authorized for the shared atomic-test context.
4. Request the exact profile/target/sequence in the admin page. Device count,
   piece count and duration are immutable properties of that versioned profile.
   Then invoke only `run-controlled-capacity.mjs`. Pipe the revealed CLI key JSON
   to stdin; the wrapper strips server credentials before spawning k6 and polls
   the control record every 250 ms.
5. Prove pause/resume/emergency-stop with a disposable smoke. The executor must
   terminate k6 within three seconds of emergency-stop.
6. Run the required smoke, idempotency, microbatch, priority, contention,
   atomic8, nominal and burst profiles. Keep each `*.control.json` sidecar.
7. Fill one target, the evidence and sidecars in
   `capacity-gate-manifest.example.json`, then run
   `npm run capacity:gate -- <manifest>`. Missing evidence is always NO-GO.
8. Reconcile before cleanup. Archive the anonymized metrics only.
9. Pipe the API key list into `cleanup-capacity-fixture.mjs`, invoke
   `cleanup_capacity_fixture_v3`, then reconcile again.

The browser administration page only requests and controls runs. It never holds
a server key and does not generate load itself. Direct `k6 run` invocations are
not an approved capacity path because they cannot honor the control plane.
