/* Source observations only. Portal aggregates never create local animal use. */
export const IACUC_PORTAL_USAGE_FIELD='portal_usage_snapshots';
export const IACUC_PORTAL_ORIGIN='https://sh-acis.tmu.edu.tw';
export const IACUC_PORTAL_PERIOD_KINDS=Object.freeze(['protocol_total','financial_year','grant_duration','unknown']);
const AXES=['strain','genotype','room','facility','spf','other'];
const COUNTS=['allowance','used','pending','remaining'];
const SNAPSHOT_KEYS=['schema_version','protocol_number','protocol_id','portal_protocol_id','source_url','source_page','observed_at','as_of_date','coverage','periods','content_sha256'];
const PERIOD_KEYS=['period_id','period_kind','period_label','scope_label','grant_id','species','unit','start_date','end_date',...COUNTS,'used_complete','same_scope','pending_is_disjoint','breakdowns','count_basis','allocation_partition_complete','allocations'];
const BREAKDOWN_KEYS=['axis','label',...COUNTS];
const ALLOCATION_KEYS=['allocation_id','ordinal','label','species','unit',...COUNTS,'genotype_label','room_label','facility_label'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const list=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():'';
const own=(v,k)=>Object.hasOwn(v,k);
const live=v=>v&&!v.app_archived_at&&v.archived!==true;
const plainKeys=(value,allowed,label,errors)=>{if(!object(value)){errors.push(label+' must be an object.');return false;}if(Object.keys(value).some(key=>!allowed.includes(key)))errors.push(label+' contains unsupported fields.');return true;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const stamp=v=>{if(typeof v!=='string'||!validDate(v.slice(0,10)))return false;const m=v.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/);return Boolean(m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3])<60&&(!m[4]||Number(m[4])<=14&&Number(m[5])<60&&(Number(m[4])<14||Number(m[5])===0))&&Number.isFinite(Date.parse(v)));};
const today=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
function bounded(value,label,errors,{required=false,max=240}={}){if(value==null&&!required)return null;if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value)){errors.push(label+' must be '+(required?'nonempty ':'')+'plain text of at most '+max+' characters.');return null;}return value.trim();}
function count(value,label,errors,{signed=false}={}){if(value==null)return null;if(!Number.isSafeInteger(value)||!signed&&value<0){errors.push(label+' must be '+(signed?'a whole number':'a nonnegative whole number')+' or null.');return null;}return value;}
function flag(value,label,errors){if(value==null)return false;if(typeof value!=='boolean'){errors.push(label+' must be true or false.');return false;}return value;}
function sourceURL(value,errors){try{const u=new URL(value);if(u.origin!==IACUC_PORTAL_ORIGIN||u.username||u.password||u.search||u.hash||u.pathname.length>1000||/(?:token|session|auth|password|secret)/i.test(u.pathname))throw new Error();return u.href;}catch{errors.push('Use a token-free HTTPS SH-ACIS source URL without a query or fragment; keep a visible page ID in source_page.');return null;}}
function breakdown(value,index,errors){const label='Breakdown '+(index+1);if(!plainKeys(value,BREAKDOWN_KEYS,label,errors))return null;const out={axis:value.axis,label:bounded(value.label,label+' label',errors,{required:true})};if(!AXES.includes(out.axis))errors.push(label+' needs a supported axis.');for(const key of COUNTS)out[key]=count(value[key],label+' '+key,errors,{signed:key==='remaining'});return out;}
function allocation(value,index,errors){const label='Allocation '+(index+1);if(!plainKeys(value,ALLOCATION_KEYS,label,errors))return null;const out={allocation_id:bounded(value.allocation_id,label+' ID',errors,{required:true,max:160}),ordinal:value.ordinal,label:bounded(value.label,label+' literal label',errors,{required:true}),species:value.species,unit:value.unit};if(!Number.isSafeInteger(out.ordinal)||out.ordinal<1)errors.push(label+' needs a positive source tab ordinal.');if(out.species!=='mouse'||out.unit!=='mice')errors.push(label+' must identify mouse species and mice units.');for(const key of COUNTS)out[key]=count(value[key],label+' '+key,errors,{signed:key==='remaining'});for(const key of ['genotype_label','room_label','facility_label'])out[key]=bounded(value[key],label+' '+key,errors);return out;}
function allocationSum(rows,key){return rows.length&&rows.every(r=>Number.isSafeInteger(r[key]))?rows.reduce((n,r)=>n+r[key],0):null;}
function period(value,index,errors,warnings){const label='Period '+(index+1);if(!plainKeys(value,PERIOD_KEYS,label,errors))return null;const out={period_id:bounded(value.period_id,label+' ID',errors,{required:true,max:160}),period_kind:value.period_kind,period_label:bounded(value.period_label,label+' source label',errors,{required:true}),scope_label:bounded(value.scope_label,label+' source scope',errors,{required:true}),grant_id:bounded(value.grant_id,label+' source grant ID',errors,{max:160}),species:value.species,unit:value.unit,start_date:value.start_date??null,end_date:value.end_date??null};
 if(!IACUC_PORTAL_PERIOD_KINDS.includes(out.period_kind))errors.push(label+' needs a supported period kind.');
 if(out.species!=='mouse'||out.unit!=='mice')errors.push(label+' must explicitly identify mouse species and the mice count unit.');
 for(const key of ['start_date','end_date'])if(out[key]!==null&&!validDate(out[key]))errors.push(label+' '+key+' must be a real YYYY-MM-DD date or null.');
 if(out.start_date&&out.end_date&&out.start_date>out.end_date)errors.push(label+' starts after it ends.');
 for(const key of COUNTS)out[key]=count(value[key],label+' '+key,errors,{signed:key==='remaining'});
 for(const key of ['used_complete','same_scope','pending_is_disjoint'])out[key]=flag(value[key],label+' '+key,errors);
 out.count_basis=value.count_basis??'reported';if(!['reported','complete_allocation_sum'].includes(out.count_basis))errors.push(label+' needs a reported or complete_allocation_sum count basis.');
 out.allocation_partition_complete=flag(value.allocation_partition_complete,label+' complete allocation partition',errors);
 if(value.allocations!==undefined&&!Array.isArray(value.allocations))errors.push(label+' allocations must be an array.');if(list(value.allocations).length>200)errors.push(label+' has too many source allocations.');
 out.allocations=list(value.allocations).slice(0,200).map((r,i)=>allocation(r,i,errors)).filter(Boolean);const allocationIds=new Set(),ordinals=new Set();for(const row of out.allocations){if(allocationIds.has(row.allocation_id)||ordinals.has(row.ordinal))errors.push(label+' repeats an allocation ID or tab ordinal.');allocationIds.add(row.allocation_id);ordinals.add(row.ordinal);}out.allocations.sort((a,b)=>a.ordinal-b.ordinal);
 if(out.count_basis==='complete_allocation_sum'){
  if(!out.allocation_partition_complete||!out.same_scope||!out.allocations.length)errors.push(label+' allocation totals require an explicit complete, nonoverlapping, same-scope source partition.');
  for(const key of COUNTS){const total=allocationSum(out.allocations,key);if(total!==null&&!Number.isSafeInteger(total))errors.push(label+' '+key+' allocation sum exceeds the safe count range.');if(out[key]!==null&&out[key]!==total)errors.push(label+' '+key+' does not equal the complete source allocation sum.');out[key]=total;}
 }
 if(out.used_complete&&out.used===null)errors.push(label+' cannot mark a missing used count complete.');
 if(out.pending_is_disjoint&&out.pending===null)errors.push(label+' needs an explicit pending count before treating reservations as disjoint.');
 if(!out.same_scope)warnings.push(label+': allowance and usage are not confirmed to share a source scope; no calculated balance.');
 if(!out.start_date||!out.end_date)warnings.push(label+': dates are unspecified; do not assume a financial-year boundary or filter local events.');
 if(!out.used_complete)warnings.push(label+': used is incomplete or unknown; no calculated balance.');
 if(value.breakdowns!==undefined&&!Array.isArray(value.breakdowns))errors.push(label+' breakdowns must be an array.');
 if(list(value.breakdowns).length>200)errors.push(label+' has too many breakdowns.');
 out.breakdowns=list(value.breakdowns).slice(0,200).map((r,i)=>breakdown(r,i,errors)).filter(Boolean);
 const ids=new Set();for(const row of out.breakdowns){const key=stable([row.axis,row.label]);if(ids.has(key))errors.push(label+' repeats a breakdown axis/label.');ids.add(key);}
 out.breakdowns.sort((a,b)=>stable([a.axis,a.label]).localeCompare(stable([b.axis,b.label])));
 return out;
}
function protocol(row){return row?.iacuc_protocol??null;}
function history(row){return list(protocol(row)?.[IACUC_PORTAL_USAGE_FIELD]);}
function semanticSnapshot(snapshot){const {observed_at,content_sha256,...semantic}=snapshot;return semantic;}
function semanticPeriod(snapshot,row){return {protocol_number:snapshot.protocol_number,protocol_id:snapshot.protocol_id,portal_protocol_id:snapshot.portal_protocol_id,source_url:snapshot.source_url,source_page:snapshot.source_page,as_of_date:snapshot.as_of_date,coverage:snapshot.coverage,period:row};}
function readablePeriod(p){return object(p)&&text(p.period_id)&&typeof p.period_label==='string'&&typeof p.scope_label==='string'&&IACUC_PORTAL_PERIOD_KINDS.includes(p.period_kind)&&p.species==='mouse'&&p.unit==='mice'&&['start_date','end_date'].every(k=>p[k]==null||validDate(p[k]))&&!(p.start_date&&p.end_date&&p.start_date>p.end_date)&&COUNTS.every(k=>p[k]==null||Number.isSafeInteger(p[k])&&(k==='remaining'||p[k]>=0));}
function rawPeriods(row){const result=new Map();for(const snapshot of history(row))if(object(snapshot)&&snapshot.schema_version===1&&snapshot.protocol_number===protocol(row)?.number&&(!snapshot.protocol_id||snapshot.protocol_id===row.event_id))for(const p of list(snapshot.periods))if(readablePeriod(p))result.set(p.period_id,{period:p,snapshot});return result;}
async function sha256(value){if(!globalThis.crypto?.subtle)throw new Error('A secure browser is required to verify portal imports.');const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}

/** Strict, pure normalization. Supplied values remain observations, not approvals. */
export function validateIacucPortalSnapshot(value,row,{now=new Date().toISOString()}={}){
 const errors=[],warnings=[];if(!plainKeys(value,SNAPSHOT_KEYS,'Snapshot',errors))return {errors,warnings,snapshot:null};
 const p=protocol(row);if(!p||row.event_type!=='iacuc_protocol'||!live(row)){errors.push('Choose one existing, live IACUC protocol.');return {errors,warnings,snapshot:null};}
 if(own(p,IACUC_PORTAL_USAGE_FIELD)&&!Array.isArray(p[IACUC_PORTAL_USAGE_FIELD]))errors.push('Existing portal history is malformed; review it without replacing it.');
 if(history(row).some(s=>!object(s)||s.schema_version!==1||s.protocol_number!==p.number||s.protocol_id&&s.protocol_id!==row.event_id||!Array.isArray(s.periods)||s.periods.some(r=>!readablePeriod(r))))errors.push('Existing portal history has an invalid identity or period; review it before appending.');
 if(value.schema_version!==1)errors.push('Unsupported portal snapshot schema version.');
 if(value.protocol_number!==p.number)errors.push('The exact source protocol number must match the selected protocol; aliases and similar numbers are not imported automatically.');
 if(value.protocol_id!==undefined&&value.protocol_id!==row.event_id)errors.push('The internal protocol ID does not match the selected protocol.');
 const out={schema_version:1,protocol_number:bounded(value.protocol_number,'Protocol number',errors,{required:true}),protocol_id:row.event_id,portal_protocol_id:bounded(value.portal_protocol_id,'Portal protocol ID',errors,{max:160}),source_url:sourceURL(value.source_url,errors),source_page:bounded(value.source_page,'Visible source page',errors,{max:400}),observed_at:null,as_of_date:value.as_of_date??null,coverage:value.coverage,periods:[]};
 if(!stamp(value.observed_at))errors.push('Observation time must include a real date, time and UTC offset.');else {out.observed_at=new Date(value.observed_at).toISOString();if(Date.parse(out.observed_at)>Date.parse(now)+5*60*1000)errors.push('Observation time is in the future.');}
 const latestObservation=history(row).reduce((n,s)=>stamp(s.observed_at)?Math.max(n,Date.parse(s.observed_at)):n,0);if(out.observed_at&&Date.parse(out.observed_at)<latestObservation)errors.push('This observation predates the latest stored capture. Review current source evidence before importing.');
 if(out.as_of_date!==null&&!validDate(out.as_of_date))errors.push('Source as-of date must be a real YYYY-MM-DD date or null.');
 if(out.as_of_date&&out.observed_at&&out.as_of_date>today(out.observed_at))errors.push('Source as-of date is after the observation date.');
 if(!['complete','partial'].includes(out.coverage))errors.push('Choose complete or partial source coverage.');
 if(!Array.isArray(value.periods)||value.periods.length<1||value.periods.length>100)errors.push('A snapshot needs between 1 and 100 source period rows.');
 out.periods=list(value.periods).slice(0,100).map((v,i)=>period(v,i,errors,warnings)).filter(Boolean);
 const ids=new Set();for(const item of out.periods){if(ids.has(item.period_id))errors.push('Source period IDs must be unique within a snapshot.');ids.add(item.period_id);}
 out.periods.sort((a,b)=>String(a.period_id).localeCompare(String(b.period_id)));
 const priorPeriods=rawPeriods(row);for(const item of out.periods){const prior=priorPeriods.get(item.period_id)?.period;if(prior&&['period_kind','period_label','scope_label','grant_id','start_date','end_date'].some(k=>prior[k]!=null&&prior[k]!==item[k]))errors.push('A source period ID cannot be reused for a different period, grant or scope. Use a distinct source period ID and retain the earlier bucket.');}
 const knownIds=new Set(history(row).map(s=>s.portal_protocol_id).filter(Boolean));if(out.portal_protocol_id&&knownIds.size&&!knownIds.has(out.portal_protocol_id))errors.push('The portal protocol ID differs from this protocol’s recorded source identity.');
 if(knownIds.size>1)errors.push('Existing portal identities conflict. Review the protocol before importing.');
 if(history(row).length>=1000)errors.push('Portal snapshot history needs a reviewed storage migration before another append; history will not be truncated.');
 if(value.content_sha256!==undefined&&!/^[0-9a-f]{64}$/.test(value.content_sha256))errors.push('The supplied content hash is invalid.');
 return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],snapshot:errors.length?null:out};
}

/** Synchronous managed-record guard for callers validating ordinary saves.
 * A portal import may only extend the exact prior array, with no co-edits. */
export function validateIacucPortalHistoryChange(before,after,{now=new Date().toISOString()}={}){
 const errors=[],old=protocol(before),next=protocol(after),previous=old?.[IACUC_PORTAL_USAGE_FIELD],incoming=next?.[IACUC_PORTAL_USAGE_FIELD];
 if(stable(previous??null)===stable(incoming??null))return {errors};
 if(!old||!next||before.event_id!==after.event_id||before.event_type!=='iacuc_protocol'||after.event_type!=='iacuc_protocol'){errors.push('Portal history can be appended only to one existing protocol.');return {errors};}
 if(previous!==undefined&&!Array.isArray(previous)||!Array.isArray(incoming)){errors.push('Portal history must remain an append-only array.');return {errors};}
 const prior=list(previous);if(incoming.length<=prior.length||prior.some((s,i)=>stable(s)!==stable(incoming[i])))errors.push('Existing portal snapshots cannot be edited, removed or reordered.');
 if(incoming.length>1000)errors.push('Portal history cannot exceed the reviewed storage limit.');
 let accumulated=before;
 for(const snapshot of incoming.slice(prior.length)){
  errors.push(...validateIacucPortalSnapshot(snapshot,accumulated,{now}).errors);
  if(!/^[0-9a-f]{64}$/.test(snapshot?.content_sha256||''))errors.push('Every appended snapshot needs its verified content hash.');
  accumulated={...before,iacuc_protocol:{...old,[IACUC_PORTAL_USAGE_FIELD]:[...history(accumulated),snapshot]}};
 }
 const withoutHistory=row=>{const p={...row.iacuc_protocol};delete p[IACUC_PORTAL_USAGE_FIELD];return {...row,iacuc_protocol:p};};
 if(stable(withoutHistory(before))!==stable(withoutHistory(after)))errors.push('A portal-count import cannot change other protocol or record fields.');
 return {errors};
}

/** Preview produces an exact candidate dataset; callers must retain their fresh
 * dataset/version baseline and save through the ordinary supported control. */
export async function previewIacucPortalImport(dataset,input,{targetProtocolId=null,now=new Date().toISOString()}={}){
 const errors=[],warnings=[],changes=[];let unchangedCount=0;
 if(typeof input==='string'){if(input.length>750000)return {errors:['Portal count JSON is too large.'],warnings,dataset:null,changes,unchangedCount};try{input=JSON.parse(input);}catch{return {errors:['Portal count JSON is invalid.'],warnings,dataset:null,changes,unchangedCount};}}
 if(!plainKeys(input,['schema_version','snapshots'],'Import',errors)||input?.schema_version!==1||!Array.isArray(input?.snapshots)||input.snapshots.length<1||input.snapshots.length>100){errors.push('Use a schema_version 1 import with between 1 and 100 snapshots.');return {errors:[...new Set(errors)],warnings,dataset:null,changes,unchangedCount};}
 if(targetProtocolId!==null&&input.snapshots.length!==1)errors.push('Import exactly one snapshot into the selected protocol.');
 const events=list(dataset?.tables?.husbandry_events),registry=events.filter(r=>r.event_type==='iacuc_protocol'&&protocol(r)&&live(r)),seen=new Set(),prepared=[];
 for(const value of input.snapshots){const matches=registry.filter(r=>protocol(r).number===value?.protocol_number&&(!targetProtocolId||r.event_id===targetProtocolId));if(matches.length!==1){errors.push('Each snapshot must match one exact existing protocol number in the selected scope.');continue;}const row=matches[0];if(seen.has(row.event_id)){errors.push('Import a protocol only once per preview.');continue;}seen.add(row.event_id);
  const checked=validateIacucPortalSnapshot(value,row,{now});errors.push(...checked.errors);warnings.push(...checked.warnings);if(!checked.snapshot)continue;
  const snapshot=checked.snapshot,hash=await sha256(semanticSnapshot(snapshot));if(value.content_sha256&&value.content_sha256!==hash){errors.push('The supplied snapshot content hash does not match its values.');continue;}snapshot.content_sha256=hash;
  const latest=rawPeriods(row),unchanged=snapshot.periods.every(item=>{const prior=latest.get(item.period_id);return prior&&stable(semanticPeriod(snapshot,item))===stable(semanticPeriod(prior.snapshot,prior.period));});
  if(unchanged){unchangedCount++;continue;}
  const latestTime=history(row).reduce((n,s)=>stamp(s.observed_at)?Math.max(n,Date.parse(s.observed_at)):n,0);if(Date.parse(snapshot.observed_at)<latestTime){errors.push('This observation predates the latest stored capture. Review current source evidence before importing.');continue;}
  const record={...row,iacuc_protocol:{...protocol(row),[IACUC_PORTAL_USAGE_FIELD]:[...history(row),snapshot]}};
  errors.push(...validateIacucPortalHistoryChange(row,record,{now}).errors);
  prepared.push({protocolId:row.event_id,number:protocol(row).number,record,hash,snapshot,summary:getIacucPortalUsage(record,{now})});
 }
 if(errors.length)return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],dataset:null,changes:[],unchangedCount:0};
 changes.push(...prepared);const replacements=new Map(changes.map(c=>[c.protocolId,c.record]));
 const next=changes.length?{...dataset,tables:{...dataset.tables,husbandry_events:events.map(row=>replacements.get(row.event_id)||row)}}:dataset;
 return {errors:[],warnings:[...new Set(warnings)],dataset:next,changes,unchangedCount};
}

function enrich(item,{day,now,staleAfterHours,protocolCurrent}){const p=item.period,s=item.snapshot,warnings=[];const datesKnown=validDate(p.start_date)&&validDate(p.end_date),periodStatus=!datesKnown?'unknown':day<p.start_date?'future':day>p.end_date?'expired':'current';
 const sourceDayEnd=validDate(s.as_of_date)?Date.parse(s.as_of_date+'T23:59:59+08:00'):null;
 const invalidSourceDate=s.as_of_date!=null&&(!validDate(s.as_of_date)||s.as_of_date>today(now)||stamp(s.observed_at)&&s.as_of_date>today(s.observed_at));
 const stale=invalidSourceDate||!stamp(s.observed_at)||Date.parse(s.observed_at)>Date.parse(now)+5*60000||Date.parse(now)-Date.parse(s.observed_at)>staleAfterHours*3600000||sourceDayEnd!==null&&Date.parse(now)-sourceDayEnd>staleAfterHours*3600000;
 const compatible=p.same_scope===true&&p.used_complete===true&&p.period_kind!=='unknown'&&Number.isSafeInteger(p.allowance)&&Number.isSafeInteger(p.used);
 const calculatedNotYetUsed=compatible?p.allowance-p.used:null,calculatedAvailable=compatible&&p.pending_is_disjoint===true&&Number.isSafeInteger(p.pending)?calculatedNotYetUsed-p.pending:null;
 const reported=Number.isSafeInteger(p.remaining)?p.remaining:null,remainingDisplay=reported??calculatedAvailable??calculatedNotYetUsed,remainingKind=reported!==null?p.count_basis==='complete_allocation_sum'?'allocation_sum':'portal':calculatedAvailable!==null?'calculated_available':calculatedNotYetUsed!==null?'not_yet_used':'unknown';
 if(reported!==null&&calculatedAvailable!==null&&reported!==calculatedAvailable)warnings.push('Portal remaining differs from the supported allowance/use/reservation calculation.');
 if(p.count_basis==='complete_allocation_sum')warnings.push('Totals are sums of complete portal allocation tabs, not an explicit overall row or a count of unique mouse SIDs.');
 if(p.count_basis!=='complete_allocation_sum'&&p.allocation_partition_complete)for(const key of COUNTS){const sum=allocationSum(list(p.allocations),key);if(sum!==null&&p[key]!=null&&sum!==p[key])warnings.push('The reported '+key+' total differs from its complete source allocation rows.');}
 if(!p.same_scope)warnings.push('Count scopes are not confirmed to match.');if(!p.used_complete)warnings.push('Used is incomplete or unknown.');if(periodStatus==='unknown')warnings.push('Allowance dates are unspecified; current authorization is not established.');if(periodStatus==='expired')warnings.push('This allowance period has ended.');if(stale)warnings.push('Source observation is stale.');
 if(invalidSourceDate)warnings.push('Source as-of date is invalid or future-dated.');
 if(!protocolCurrent)warnings.push('Current protocol approval and validity are not established.');
 return {periodId:p.period_id,kind:p.period_kind,label:p.period_label,scopeLabel:p.scope_label,grantId:p.grant_id??null,allowance:p.allowance??null,used:p.used??null,pending:p.pending??null,remaining:reported,remainingDisplay,remainingKind,calculatedNotYetUsed,calculatedAvailable,overBy:compatible?Math.max(0,p.used-p.allowance):null,percentUsed:compatible&&p.allowance>0?100*p.used/p.allowance:null,datesKnown,startDate:p.start_date??null,endDate:p.end_date??null,stale,periodStatus,currentAuthorization:protocolCurrent&&periodStatus==='current'&&!stale&&compatible&&['portal','allocation_sum','calculated_available'].includes(remainingKind)&&remainingDisplay>0&&!warnings.some(w=>w.includes('differs')),sourceURL:s.source_url??null,sourcePage:s.source_page??null,asOfDate:s.as_of_date??null,observedAt:s.observed_at,breakdowns:list(p.breakdowns).map(r=>({...r})),allocations:list(p.allocations).map(r=>({...r})),countBasis:p.count_basis??'reported',allocationPartitionComplete:p.allocation_partition_complete===true,usedComplete:p.used_complete===true,sameScope:p.same_scope===true,pendingIsDisjoint:p.pending_is_disjoint===true,warnings};
}
/** Latest per-period observations remain independent: omitted periods survive;
 * overlapping annual, grant and whole-protocol constraints are never summed. */
export function getIacucPortalUsage(row,{periodId=null,day=null,now=new Date().toISOString(),staleAfterHours=36}={}){
 day=validDate(day)?day:today(now);const p=protocol(row),protocolCurrent=Boolean(live(row)&&p?.status==='approved'&&validDate(p.start_date)&&validDate(p.end_date)&&p.start_date<=day&&day<=p.end_date);
 const periods=[...rawPeriods(row).values()].map(item=>enrich(item,{day,now,staleAfterHours,protocolCurrent})).sort((a,b)=>String(b.startDate||'').localeCompare(String(a.startDate||''))||a.label.localeCompare(b.label));
 let selected=periodId?periods.find(p=>p.periodId===periodId)||null:null;
 if(!periodId&&periods.length===1)selected=periods[0];
 const warnings=[];if(periodId&&!selected)warnings.push('The selected source period is unavailable.');if(!selected&&periods.length)warnings.push('Choose the applicable source period; overlapping or undated allowances cannot be selected by guess.');
 if(selected)warnings.push(...selected.warnings);
 const latestObservedAt=history(row).reduce((value,s)=>stamp(s.observed_at)&&(!value||Date.parse(s.observed_at)>Date.parse(value))?s.observed_at:value,null);
 return {periods,selected,status:!periods.length?'no_data':selected?'selected':'period_required',displayOnlySelection:Boolean(selected&&!periodId&&selected.periodStatus!=='current'),warnings,latestObservedAt};
}
