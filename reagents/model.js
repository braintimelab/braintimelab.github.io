export const SECTIONS = Object.freeze([
  ['orders','☷','Orders'],['inventory','▦','Inventory'],['safety','⚠','Dangerous chemicals'],['usage','◷','Usage'],
  ['vendors','⌂','Vendors'],['equipment','⚙','Equipment'],
  ['history','↶','History'],['review','⚑','Review'],['settings','☰','Settings']
]);
export const canReviewHistory = permissions => ['owner','manager'].includes(permissions?.role);
export const visibleSections = permissions => SECTIONS.filter(([id])=>!['history','review'].includes(id)||canReviewHistory(permissions));
export const STATUSES = ['listed_current','in_stock','low_stock','depleted','out_of_stock','ordered','disposed','unverified','historical'];
export const labels = {listed_current:'Listed in current sheet',in_stock:'In stock',low_stock:'Low stock',depleted:'Used up',out_of_stock:'Out of stock',ordered:'Ordered',disposed:'Disposed',unverified:'Needs verification',historical:'Historical',open:'Open',resolved:'Resolved',complete:'Complete',pending:'Pending'};
export const text = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
export const esc = v => text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value) {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function hazardous(p) {
  const known=value=>Array.isArray(value)?value.some(known):!['','unknown','unverified','none','n','no','無','未確認','未分類','not recorded'].includes(text(value).trim().toLowerCase());
  return p.safety?.flagged===true || p.safety?.regulated===true || [p.safety?.hazard_codes,p.safety?.classification,p.safety?.regulatory_list,p.hazard_statements].some(known);
}
export function quantity(p) {
  if(typeof p.remaining_amount==='number'&&Number.isFinite(p.remaining_amount)&&p.remaining_amount>=0)return `${p.remaining_amount} ${p.unit||'(unit unknown)'}`;
  for(const value of [p.quantity_text,p.remaining_amount])if(value!=null&&(typeof value!=='number'||Number.isFinite(value)&&value>=0)&&text(value).trim())return text(value);
  const packaging=[['Pack',p.package_size_raw],['Containers',p.container_count_raw]].filter(([,value])=>value!=null&&text(value).trim()).map(([label,value])=>`${label}: ${text(value)}`);
  if(packaging.length)return packaging.join(' · ');
  return p.amount!=null&&text(p.amount).trim()?text(p.amount):'Unknown';
}
export function itemName(r) {return text(r.payload?.name||r.payload?.title||r.id);}
export function itemClassification(row) {
  const p=row.payload||row,normalize=value=>text(value).trim().toLocaleLowerCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ');
  const labels={equipment:'Equipment',equipments:'Equipment',ab:'Antibody',antibody:'Antibody',antibodies:'Antibody',chemical:'Chemicals',chemicals:'Chemicals','surgical/animal':'Surgical / animal','plastic/mol. bio':'Plastic / Mol. bio','optics/chamber':'Optics / chamber',consumable:'Consumable',consumables:'Consumable'};
  if([row.kind,p.inventory_type].some(value=>['equipment','equipments'].includes(normalize(value))))return 'Equipment';
  for(const value of [p.inventory_classification,p.source_sheet,p.source_ref?.sheet?.title,p.source_ref?.sheet,p.sheet,p.source_fields?.sheet,p.inventory_type,p.category]){
    const label=labels[normalize(value)];if(label)return label;
  }
  return 'Unclassified';
}
export function filterItems(rows,{query='',category='',classification='',status='',location='',dangerous=false}={}) {
  const q=query.trim().toLocaleLowerCase();
  return rows.filter(r=>!r.archived&&(!category||itemClassification(r)===category)&&(!classification||itemClassification(r)===classification)&&(!status||r.payload.status===status)&&(!location||r.payload.location===location)&&(!dangerous||(r.kind!=='equipment'&&hazardous(r.payload)))&&(!q||text(r.payload).toLocaleLowerCase().includes(q))).sort((a,b)=>itemName(a).localeCompare(itemName(b))||a.id.localeCompare(b.id));
}
export function stockStats(rows,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})) {
  const p=rows.filter(r=>!r.archived).map(r=>r.payload);
  return {listed:p.length,needsCheck:p.filter(x=>!x.status||['listed_current','unverified'].includes(x.status)).length,dangerous:p.filter(hazardous).length,expired:p.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.expiry_date||'')&&x.expiry_date<today&&!['depleted','disposed','out_of_stock'].includes(x.status)).length};
}
export function numeric(value,label,{optional=true,min=0}={}) {
  if(text(value).trim()===''){if(optional)return null;throw Error(`${label} is required.`);}
  const valueType=typeof value;if(!['string','number'].includes(valueType)||valueType==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))throw Error(`${label} must be a decimal number.`);
  const n=Number(value);if(!Number.isFinite(n)||n<min)throw Error(`${label} must be a number of at least ${min}.`);return n;
}
function decimalDifference(left,right) {
  // Align the decimal values that JSON sends to PostgreSQL NUMERIC, including exponents.
  const parts=value=>{const [mantissa,exponent='0']=String(value).split(/e/i);return {digits:BigInt(mantissa.replace('.','')),scale:(mantissa.split('.')[1]||'').length-Number(exponent)};};
  const a=parts(left),b=parts(right),scale=Math.max(0,a.scale,b.scale);
  const digits=(a.digits*10n**BigInt(scale-a.scale)-b.digits*10n**BigInt(scale-b.scale)).toString().padStart(scale+1,'0');
  return Number(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
}
export function usageEvent(values,item,id,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})) {
  const amount=numeric(values.amount,'Amount',{optional:false,min:Number.MIN_VALUE}),unit=text(values.unit).trim();
  if(!unit||unit.length>40)throw Error('Enter a quantity unit of at most 40 characters.');
  if(!validDate(values.event_date)||values.event_date>today)throw Error('Choose a valid usage date no later than today.');
  if(values.apply_balance&&(typeof item.remaining_amount!=='number'||!Number.isFinite(item.remaining_amount)||item.remaining_amount<0||item.unit!==unit||amount>item.remaining_amount))throw Error('To subtract stock, use the exact recorded unit and an amount within the known balance.');
  return {id,name:text(item.name),amount,unit,event_date:values.event_date,local_time:values.local_time||'',timezone:'Asia/Taipei',operator:values.operator||'',purpose:values.purpose||'',notes:values.notes||'',...(values.apply_balance===true?{remaining_amount:decimalDifference(item.remaining_amount,amount),remaining_unit:unit}:{})};
}
// Historical usage records retain the units in their original column headings.
// A recorded balance is an observation at that date, never a calculated stock total.
export function usageSummary(row) {
  const p=row.payload||row,fields={...p.fields,...p.source_fields,...p.original_fields};
  // record_date may be the import snapshot, not the date of use.
  const rawDate=[p.event_date,p.used_at,p.date,p.period].find(value=>value!=null&&text(value).trim())??'';
  const period=text(rawDate).trim(),candidate=period.slice(0,10),date=validDate(candidate)&&(period.length===10||/^[T ]/.test(period.slice(10)))?candidate:'';
  const sourceUnit=prefix=>{const units=[...new Set(Object.keys(fields).map(key=>key.match(prefix)?.[1]?.trim()).filter(Boolean))];return units.length===1?units[0]:'';};
  const usedUnit=text(p.unit).trim()||sourceUnit(/^Used\s+(?:volume|amount)\s*\(([^)]+)\)$/i);
  const remainingUnit=text(p.remaining_unit).trim()||sourceUnit(/^Remaining\s+(?:vol\.?|volume|amount)\s*\(([^)]+)\)$/i)||(p.remaining_amount!=null?text(p.unit).trim():'');
  const value=values=>values.find(value=>value!=null&&text(value).trim()!=='');
  const usedRaw=value([p.amount,p.used_amount_raw,p.used_amount,p.quantity_text]),remainingRaw=value([p.remaining_amount,p.remaining_raw,p.remaining]);
  const amount=value=>{try{return numeric(value,'Quantity');}catch{return null;}};
  const usedAmount=amount(usedRaw),remainingAmount=amount(remainingRaw);
  const display=(raw,number,unit)=>number!=null?`${number}${unit?' '+unit:' (unit unknown)'}`:raw!=null&&typeof raw!=='number'&&text(raw).trim()?text(raw):'—';
  return {period:date||period||'—',date,used:display(usedRaw,usedAmount,usedUnit),remaining:display(remainingRaw,remainingAmount,remainingUnit),usedAmount,usedUnit,remainingAmount,remainingUnit,operator:text(p.operator)};
}
export function usageInPeriod(rows,{fromDate='',toDate=''}={}) {
  if((fromDate&&!validDate(fromDate))||(toDate&&!validDate(toDate))||(fromDate&&toDate&&fromDate>toDate))throw Error('Choose a valid usage date range.');
  return rows.filter(row=>{if(row.archived)return false;if(!fromDate&&!toDate)return true;const {date}=usageSummary(row);return !!date&&(!fromDate||date>=fromDate)&&(!toDate||date<=toDate);});
}
export function validateBundle(bundle) {
  if(!bundle||bundle.schema_version!==1||!['sources','records','observations'].every(k=>Array.isArray(bundle[k])))throw Error('Choose a Braintime Reagents import package (schema version 1).');
  const ids={};for(const [key,idKey] of [['sources','source_id'],['records','id'],['observations','id']]) {
    ids[key]=new Set();for(const r of bundle[key]){if(!r||typeof r!=='object'||typeof r[idKey]!=='string'||!r[idKey]||r[idKey].length>200||r[idKey]!==r[idKey].trim()||ids[key].has(r[idKey]))throw Error(`Missing or duplicate ${key} identifier.`);ids[key].add(r[idKey]);}
  }
  const nullableDate=value=>value==null||validDate(value),bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  for(const source of bundle.sources)if(typeof source.title!=='string'||!source.title.trim()||source.title.length>500||typeof source.kind!=='string'||!source.kind||source.kind.length>80||!nullableDate(source.snapshot_date)||!/^[a-f0-9]{64}$/i.test(source.hash||'')||(source.url&&(!safeURL(source.url)||!source.url.startsWith('https://')||source.url.length>2000)))throw Error('Invalid source metadata, snapshot date or SHA-256 hash.');
  for(const row of [...bundle.records,...bundle.observations])if(bytes(row.payload??null)>131072)throw Error('A record payload exceeds 128 KiB. Split the reviewed source before importing.');
  for(const row of bundle.records)if(!nullableDate(row.record_date)||(row.payload?.remaining_amount!=null&&(typeof row.payload.remaining_amount!=='number'||!Number.isFinite(row.payload.remaining_amount)||row.payload.remaining_amount<0)))throw Error('Invalid record date or numeric remaining amount.');
  for(const row of bundle.observations)if(!nullableDate(row.snapshot_date)||text(row.section).length>200||text(row.row_ref).length>500)throw Error('Invalid observation date or row reference.');
  for(const r of bundle.records)if(!['item','usage','order','vendor','equipment','safety','review'].includes(r.kind)||!r.payload||Array.isArray(r.payload)||typeof r.payload!=='object'||(r.source_id&&!ids.sources.has(r.source_id)))throw Error('Invalid record or missing source.');
  for(const o of bundle.observations)if(!ids.sources.has(o.source_id)||(o.item_id&&!bundle.records.some(r=>r.id===o.item_id&&r.kind==='item'))||!o.payload||typeof o.payload!=='object'||Array.isArray(o.payload))throw Error('Observation has an unknown source/item or invalid payload.');
  return {sources:bundle.sources.length,records:bundle.records.length,observations:bundle.observations.length,items:bundle.records.filter(r=>r.kind==='item').length,privateSources:bundle.sources.filter(s=>s.owner_only||/email/i.test(s.kind)).length};
}
// Sources first, then records, then observations: foreign keys remain valid at every boundary.
export function importChunks(bundle,maxBytes=900000) {
  validateBundle(bundle);const chunks=[],encoder=new TextEncoder();
  for(const [key,arg,limit] of [['sources','p_sources',150],['records','p_records',300],['observations','p_observations',250]]) {
    let batch={p_sources:[],p_records:[],p_observations:[]},size=100;
    for(const row of bundle[key]){const bytes=encoder.encode(JSON.stringify(row)).length+2;if(bytes+100>maxBytes)throw Error('A source row is too large for one import batch.');if(batch[arg].length&&(batch[arg].length>=limit||size+bytes>maxBytes)){chunks.push(batch);batch={p_sources:[],p_records:[],p_observations:[]};size=100;}batch[arg].push(row);size+=bytes;}
    if(batch[arg].length)chunks.push(batch);
  }return chunks;
}
export async function batchID(batch,cryptoAPI=globalThis.crypto) {const digest=await cryptoAPI.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(batch)));return 'reagents-v1-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
export function exportTable(rows) {const keys=[...new Set(rows.flatMap(r=>Object.keys(r.payload||{})))].sort();return [['Record ID','Type','Version','Source ID','Record date',...keys],...rows.map(r=>[r.id,r.kind,r.version,r.source_id||'',r.record_date||'',...keys.map(k=>typeof r.payload[k]==='object'?text(r.payload[k]):r.payload[k]??'')])];}

export function validDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function mergeRecordFields(previous,values,fields,{canManageSafety=true}={}) {
  const payload=structuredClone(previous);
  for(const [key,,type] of fields){
    if((key==='storage'&&!canManageSafety)||(previous.balance_applied===true&&['amount','unit'].includes(key))||(previous[key]!==null&&typeof previous[key]==='object'))continue;
    payload[key]=type==='number'?numeric(values[key],key):text(values[key]??'');
  }
  payload.name=text(payload.name).trim();if(!payload.name)throw Error('Enter a name.');
  payload.status=values.status;if(previous.notes===null||typeof previous.notes!=='object')payload.notes=text(values.notes??'');return payload;
}
export function mergeSafety(previous,values) {
  if(values.sds_url&&!safeURL(values.sds_url))throw Error('Use a valid http or https SDS link.');
  const next={...structuredClone(previous),...values};
  next.hazard_codes=text(values.hazard_codes).split(',').map(s=>s.trim()).filter(Boolean);
  return next;
}
export async function collectPages(call,args={},check=()=>{}) {
  const rows=[],seen=new Set();let offset=0;
  for(;;){
    check();const page=await call({...args,p_offset:offset,p_limit:500});check();
    if(!page||!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||page.total<0)throw Error('The server returned an invalid page. Refresh before exporting.');
    for(const row of page.rows){const key=row.id??row.source_id??row.audit_id;if(key!=null){if(seen.has(key))throw Error('Records changed during pagination. Refresh and try again.');seen.add(key);}rows.push(row);}
    if(page.next_offset===null)return rows;
    if(!Number.isSafeInteger(page.next_offset)||page.next_offset!==offset+page.rows.length||page.next_offset<=offset||page.next_offset>1000000)throw Error('Pagination could not be verified. Refresh and try again.');
    offset=page.next_offset;
  }
}
export async function executeImport(bundle,{call,check=()=>{},onProgress=()=>{},cryptoAPI=globalThis.crypto}={}) {
  const chunks=importChunks(bundle),report={sources:0,records:0,observations:0,conflicts:[],completed_batches:0,total_batches:chunks.length,replayed_batches:0,complete:false};
  try {
    for(let i=0;i<chunks.length;){
      check();onProgress(i+1,chunks.length);const batch=chunks[i],id=await batchID(batch,cryptoAPI);check();
      let result;
      try {result=await call({...batch,p_batch_id:id});}
      catch(error){
        check();
        // This database cancellation rolls back the entire request. Network or
        // permission errors can have different outcomes and must never be retried here.
        const key=Object.keys(batch).find(k=>batch[k].length),rows=batch[key];
        if(error?.message!=='canceling statement due to statement timeout'||rows.length<50)throw error;
        const middle=Math.floor(rows.length/2);
        const halves=[rows.slice(0,middle),rows.slice(middle)].map(part=>({...batch,[key]:part}));
        chunks.splice(i,1,...halves);report.total_batches=chunks.length;
        continue;
      }
      check();
      if(!result||!Array.isArray(result.conflicts)||!['sources_inserted','records_inserted','observations_inserted'].every(k=>Number.isSafeInteger(result[k])&&result[k]>=0))throw Error('The import result was not confirmed. Retry the same package to resume safely.');
      if(result.replayed)report.replayed_batches++;
      else {report.sources+=result.sources_inserted;report.records+=result.records_inserted;report.observations+=result.observations_inserted;}
      report.conflicts=[...new Set([...report.conflicts,...result.conflicts])];report.completed_batches++;i++;
    }
    report.complete=true;return report;
  } catch(error){error.importReport=report;throw error;}
}
