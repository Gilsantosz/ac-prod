import { createHash } from 'node:crypto';
export const TARGET = 'https://smnsihksrhzbkhcbdjfu.supabase.co';
export const PRODUCTION = 'https://uozuzdfvnufsjsonswag.supabase.co';
export const SEED = 'LOAD_TEST_20260922_V1';
export const PREFIX = 'ACPROD-CT-LOAD-TEST-20260922-V1';
export const LIMITS = Object.freeze({ack_p95_ms:400,ack_p99_ms:800,processing_p99_ms:1000,realtime_p95_ms:1000,error_rate:0.001});
export const STAGES = [
  ['cut','Corte',25],['edge','Borda',30],['drill','Furação',15],
  ['cnc','Usinagem',10],['joinery','Marcenaria',10],
  ['separation','Separação',5],['packaging','Embalagem',5],
];
export function id(key) {
  const h=createHash('sha256').update(`${SEED}:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function assertTarget(url) {
  if(url!==TARGET) throw new Error('STAGING_ONLY: exact capacity-test URL required');
}
export function createPlan() {
  const stations=STAGES.flatMap(([stage,name,count])=>Array.from({length:count},(_,i)=>({
    stage_id:stage,cell_name:name,stage_station_index:i,
    machine_id:id(`machine:${stage}:${i}`),station_id:id(`machine:${stage}:${i}`),
    physical_cell_id:id(`machine:${stage}:${i}`),
    physical_cell_mapping:'one physical station per physical cell; backend machine_id',
    station_name:`${PREFIX}-${stage.toUpperCase()}-${String(i+1).padStart(2,'0')}`,
  })));
  const clients=Array.from({length:200},(_,index)=>({
    index,role:index<100?'operator':'viewer',device_id:id(`device:${index}`),
    operator_id:index<100?id(`operator:${index}`):null,
    ...(index<100?stations[index]:{screen:['dashboard','traceability','history','lots','production','kpis'][index%6]}),
    sector_id:null,
  }));
  return {format:'acprod-capacity-plan-v1',seed:SEED,prefix:PREFIX,target:TARGET,
    fixture_run_id:id('run'),clients,stations,
    limitations:['sector isolation is not yet represented by a verified backend field',
      'physical cells are 1:1 with machines in this fixture; multiple machines in one physical cell is not certified'],
    profiles:{smoke:{sessions:20,collectors:10,rate_per_minute:100,duration_seconds:60},
      connections:{sessions:200,collectors:100,rate_per_minute:0,duration_seconds:600},
      nominal:{sessions:200,collectors:100,rate_per_minute:2000,duration_seconds:900},
      mixed:{sessions:200,collectors:100,rate_per_minute:2000,duration_seconds:900},
      soak:{sessions:200,collectors:100,rate_per_minute:2000,duration_seconds:3600}},
    stress_rates_per_minute:[2000,3000,4000,5000,6000],slo:LIMITS};
}
export function piecesForRate(ratePerMinute,seconds,reserve=0.10) {
  if(!Number.isInteger(ratePerMinute)||ratePerMinute<0||!Number.isInteger(seconds)||seconds<1)
    throw new Error('INVALID_WORKLOAD');
  return Math.ceil(ratePerMinute*seconds/60*(1+reserve));
}
