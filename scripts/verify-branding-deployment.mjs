import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Read-only verification of the public Pages deployment; no auth or MES data.
const site = 'https://gilsantosz.github.io/ac-prod/';
const expected = process.env.EXPECTED_COMMIT_SHA;
if (!/^[a-f0-9]{40}$/.test(expected || '')) throw new Error('EXPECTED_COMMIT_SHA is required');
let lastError;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const suffix = `?release=${expected}&check=${Date.now()}`;
    const infoResponse = await fetch(`${site}build-info.json${suffix}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(infoResponse.status, 200, 'build-info.json unavailable');
    const info = await infoResponse.json();
    assert.equal(info.commit_sha, expected, 'CDN is still serving another release');
    const logoResponse = await fetch(`${site}brand/leo-madeiras-logo.png${suffix}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(logoResponse.status, 200, 'Published PNG missing');
    assert.ok((logoResponse.headers.get('content-type') || '').startsWith('image/png'));
    const logo = Buffer.from(await logoResponse.arrayBuffer());
    assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const blobSha = createHash('sha1').update(`blob ${logo.length}\0`).update(logo).digest('hex');
    assert.equal(blobSha, '4cf10a42177f8ecdd73453cd201fed90dc145618', 'Company logo bytes changed');
    const swResponse = await fetch(`${site}sw.js${suffix}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(swResponse.status, 200);
    const sw = await swResponse.text();
    assert.ok(sw.includes('brand/leo-madeiras-logo.png'), 'PNG missing from offline cache manifest');
    assert.ok(/exceljs\.min-[a-zA-Z0-9_-]+\.js/.test(sw), 'Excel engine missing from offline cache manifest');
    console.log(JSON.stringify({ verified: true, site, commit: info.commit_sha, logoStatus: logoResponse.status,
      logoType: logoResponse.headers.get('content-type'), logoBytes: logo.length, originalLogoPreserved: true,
      logoPrecached: true, excelEnginePrecached: true }, null, 2));
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    console.warn(`Deployment check ${attempt}/12: ${error.message}`);
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
if (lastError) throw lastError;
