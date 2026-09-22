import { mkdirSync,writeFileSync } from 'node:fs';
import { TARGET, createPlan } from './plan.mjs';
import { evaluate } from './gate.mjs';
const out = process.env.CAPACITY_OUTPUT_DIR || 'capacity-artifacts';
mkdirSync(out,{recursive:true});
writeFileSync(`${out}/plan.json`,JSON.stringify(createPlan(),null,2));
const key = process.env.CAPACITY_PUBLIC_KEY;
const result = {timestamp:new Date().toISOString(),source_sha:process.env.GITHUB_SHA||null,
 target:TARGET,kind:'NON_MUTATING_READINESS_CHECK',load_executed:false,
 rpc_status:null,ready:false,capacity:evaluate({target:TARGET})};
try {
 if (!key || !key.startsWith('sb_publishable_')) throw new Error('PUBLISHABLE_KEY_REQUIRED');
 const response=await fetch(`${TARGET}/rest/v1/rpc/get_public_collection_immediate_release`,{
  method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 result.rpc_status=response.status;
 const payload=await response.json().catch(()=>({}));
 result.ready=response.ok && payload.ready===true && payload.transport==='immediate_v3'
   && payload.ingress_rpc==='ingest_collection_batch_immediate_v3' && payload.max_events_per_request===5;
 result.reason=result.ready?'RELEASE_READY_BUT_CAPACITY_UNMEASURED':String(payload.code||'RELEASE_NOT_READY');
} catch(error) { result.reason=error instanceof Error?error.message:'PREFLIGHT_FAILED'; }
writeFileSync(`${out}/real-readiness.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
// Never turn a successful health/release check into capacity PASS.
process.exitCode=2;
