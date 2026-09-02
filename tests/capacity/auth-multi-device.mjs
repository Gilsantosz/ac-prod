import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const [fixturePath, outputPath] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
if (!supabaseUrl || !anonKey || !outputPath) throw new Error('Configuração incompleta');

const timedRequest = async (url, options = {}) => {
  const started = performance.now();
  const response = await fetch(url, {
    ...options,
    headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, duration_ms: Number((performance.now() - started).toFixed(3)), data };
};

const attempts = await Promise.all((fixture.auth_users_private || []).map(async (user, index) => {
  const [deviceA, deviceB] = await Promise.all([1, 2].map(() => timedRequest(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    { method: 'POST', body: JSON.stringify({ email: user.email, password: user.password }) },
  )));
  const tokens = [deviceA.data?.access_token, deviceB.data?.access_token];
  const profileChecks = await Promise.all(tokens.map((token) => timedRequest(
    `${supabaseUrl}/rest/v1/profiles?select=id,active,role&id=eq.${user.id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )));
  const sessionChecks = await Promise.all(tokens.map((token) => timedRequest(
    `${supabaseUrl}/auth/v1/user`,
    { headers: { Authorization: `Bearer ${token}` } },
  )));
  return {
    user_slot: index + 1,
    device_a: { status: deviceA.status, duration_ms: deviceA.duration_ms },
    device_b: { status: deviceB.status, duration_ms: deviceB.duration_ms },
    profiles: profileChecks.map((check) => ({ status: check.status, duration_ms: check.duration_ms, active: check.data?.[0]?.active === true })),
    sessions_preserved: sessionChecks.every((check) => check.ok && check.data?.id === user.id),
  };
}));

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || 0;
};
const loginDurations = attempts.flatMap((attempt) => [attempt.device_a.duration_ms, attempt.device_b.duration_ms]);
const profileDurations = attempts.flatMap((attempt) => attempt.profiles.map((profile) => profile.duration_ms));
const result = {
  run_id: fixture.run_id,
  started_users: attempts.length,
  simultaneous_sessions: attempts.length * 2,
  successful_logins: attempts.flatMap((attempt) => [attempt.device_a, attempt.device_b]).filter((login) => login.status === 200).length,
  sessions_preserved: attempts.filter((attempt) => attempt.sessions_preserved).length,
  login_ms: { p50: percentile(loginDurations, 0.5), p95: percentile(loginDurations, 0.95), p99: percentile(loginDurations, 0.99), max: Math.max(...loginDurations) },
  profile_ms: { p50: percentile(profileDurations, 0.5), p95: percentile(profileDurations, 0.95), p99: percentile(profileDurations, 0.99), max: Math.max(...profileDurations) },
  attempts,
  finished_at: new Date().toISOString(),
};
await writeFile(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });
process.stdout.write(JSON.stringify({ ...result, attempts: undefined }));
