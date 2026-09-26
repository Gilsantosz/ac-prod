import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan,id,assertTarget,TARGET,PRODUCTION,piecesForRate,LIMITS } from './plan.mjs';
test('200 independent identities and 100 physical stations',()=>{
 const p=createPlan(); assert.equal(p.clients.length,200);assert.equal(p.stations.length,100);
 assert.equal(new Set(p.clients.map(c=>c.device_id)).size,200);
 assert.equal(new Set(p.stations.map(c=>c.machine_id)).size,100);
 assert.equal(p.clients.filter(c=>c.role==='operator').length,100);
 assert.equal(p.clients.filter(c=>c.role==='viewer').length,100);
});
test('every production stage has multiple physical stations',()=>{
 for(const stage of new Set(createPlan().stations.map(s=>s.stage_id)))
 assert.ok(createPlan().stations.filter(s=>s.stage_id===stage).length>=2);
});
test('same seed is byte deterministic',()=>assert.equal(JSON.stringify(createPlan()),JSON.stringify(createPlan())));
test('valid UUIDs preserve identity independently of loop order',()=>{
 assert.match(id('machine:cut:0'),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.notEqual(id('machine:cut:0'),id('machine:cut:1'));
});
test('production and URL lookalikes are rejected',()=>{
 assert.doesNotThrow(()=>assertTarget(TARGET));
 for(const url of [PRODUCTION,`${TARGET}/`,`${TARGET}.evil.test`,TARGET.replace('https','http'),'']) assert.throws(()=>assertTarget(url));
});
test('nominal is 2000/minute for 15 minutes, soak 60 minutes',()=>{
 const p=createPlan();assert.equal(p.profiles.nominal.rate_per_minute,2000);
 assert.equal(p.profiles.nominal.duration_seconds,900);assert.equal(p.profiles.soak.duration_seconds,3600);
});
test('data quantity is generated, never manually requested',()=>{
 assert.equal(piecesForRate(2000,900,0),30000);assert.equal(piecesForRate(2000,3600,0),120000);assert.ok(piecesForRate(2000,900)>30000);
});
test('mandatory SLOs remain exact',()=>assert.deepEqual(LIMITS,{ack_p95_ms:400,ack_p99_ms:800,processing_p99_ms:1000,realtime_p95_ms:1000,error_rate:0.001}));
test('unknown sector mapping is explicit, not a synthetic success',()=>{
 assert.equal(createPlan().clients[0].sector_id,null);assert.ok(createPlan().limitations.length);
});
