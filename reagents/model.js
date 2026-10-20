export const SECTIONS = Object.freeze([
  ['orders','☷','Orders'],['inventory','▦','Inventory'],['safety','⚠','Dangerous chemicals'],['usage','◷','Usage'],
  ['vendors','⌂','Vendors'],['equipment','⚙','Equipment'],
  ['history','↶','History'],['review','⚑','Review'],['settings','☰','Settings']
]);
export const canReviewHistory = permissions => ['owner','manager'].includes(permissions?.role)&&(permissions?.role==='owner'||!['orders','inventory','dangerous','usage','vendors','equipment'].some(feature=>!reagentAllows(permissions,`reagents.${feature}.read`)));
export const canViewHistory = permissions => permissions?.role==='owner';
const reagentKeys=new Set(['orders','inventory','dangerous','usage','vendors','equipment'].flatMap(feature=>['read','write'].map(mode=>'reagents.'+feature+'.'+mode)).concat('reagents.export'));
// Pure model helpers are shared with the Node replica. Keep the restriction map
// contract identical to appAllows without importing browser-only asset paths.
export function reagentAllows(permissions,key){if(!reagentKeys.has(key))return false;if(permissions?.role==='owner')return true;const map=Object.hasOwn(permissions||{},'reagentsPermissions')?permissions.reagentsPermissions:Object.hasOwn(permissions||{},'reagents_permissions')?permissions.reagents_permissions:{};return map!==null&&typeof map==='object'&&!Array.isArray(map)&&Object.getPrototypeOf(map)===Object.prototype&&Object.keys(map).length<=13&&Object.entries(map).every(([k,v])=>reagentKeys.has(k)&&typeof v==='boolean')&&map[key]!==false;}
const sectionFeature=id=>({safety:'dangerous',review:'dangerous'})[id]||id;
export const canViewSection = (permissions,id) => permissions?.guest_level ? Array.isArray(permissions.allowed_sections)&&permissions.allowed_sections.includes(id)&&!['history','review'].includes(id) : id==='settings'?true:id==='history'?canViewHistory(permissions):(id!=='review'||canReviewHistory(permissions))&&reagentAllows(permissions,`reagents.${sectionFeature(id)}.read`);
export const visibleSections = permissions => SECTIONS.filter(([id])=>canViewSection(permissions,id));
export function canWriteKind(permissions,kind='item',row=null){if(!permissions?.can_write)return false;const key=({item:row&&itemClassification(row)==='Equipment'?'equipment':'inventory',equipment:'equipment',usage:'usage',vendor:'vendors',safety:'dangerous',review:'dangerous',order:'orders'})[kind];if(!permissions.guest_level)return kind==='review'?canReviewHistory(permissions):Boolean(key)&&reagentAllows(permissions,`reagents.${key}.read`)&&reagentAllows(permissions,`reagents.${key}.write`)&&(kind!=='safety'||permissions.can_manage_safety===true);return !['review','order'].includes(kind)&&Boolean(key)&&permissions.guest_flags?.[key+'_read']===true&&permissions.guest_flags?.[key+'_write']===true;}
export const canManageSafety=permissions=>permissions?.can_manage_safety===true&&(permissions.guest_level?permissions.guest_flags?.dangerous_read===true&&permissions.guest_flags?.dangerous_write===true:reagentAllows(permissions,'reagents.dangerous.read')&&reagentAllows(permissions,'reagents.dangerous.write'));
export const canExport=permissions=>permissions?.can_export!==false&&(permissions?.guest_level?permissions.can_export===true:reagentAllows(permissions,'reagents.export')&&['orders','inventory','dangerous','usage','vendors','equipment'].every(feature=>reagentAllows(permissions,`reagents.${feature}.read`)));
export const canWriteOrders=permissions=>canViewSection(permissions,'orders')&&(permissions?.guest_level?permissions.can_order===true||permissions.can_request_purchase===true:reagentAllows(permissions,'reagents.orders.write'));
export function canReadRecord(permissions,row){if(!row)return false;if(permissions?.guest_level)return true;const kind=row.kind??row.entity_type,feature=({item:itemClassification(row)==='Equipment'?'equipment':'inventory',equipment:'equipment',usage:'usage',vendor:'vendors',safety:'dangerous',review:'dangerous',order:'orders'})[kind];return Boolean(feature)&&canViewSection(permissions,feature==='dangerous'?'safety':feature)&&(kind!=='review'||canReviewHistory(permissions))||kind==='item'&&itemClassification(row)!=='Equipment'&&hazardous(row.payload||{})&&canViewSection(permissions,'safety');}

export const STATUSES = ['listed_current','in_stock','low_stock','depleted','out_of_stock','ordered','disposed','unverified','historical'];
export const labels = {listed_current:'Listed in current sheet',in_stock:'In stock',low_stock:'Low stock',depleted:'Used up',out_of_stock:'Out of stock',ordered:'Ordered',disposed:'Disposed',unverified:'Needs verification',historical:'Historical',open:'Open',resolved:'Resolved',complete:'Complete',pending:'Pending'};
export const text = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
export const esc = v => text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value) {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function hazardous(p) {
  const known=value=>Array.isArray(value)?value.some(known):!['','unknown','unverified','none','n','no','na','n/a','無','未確認','未分類','not recorded'].includes(text(value).trim().toLowerCase());
  return p.safety?.flagged===true || p.safety?.regulated===true || [p.safety?.hazard_codes,p.safety?.classification,p.safety?.ghs_classification,p.safety?.regulatory_list,p.hazard_statements].some(known);
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
  return rows.filter(r=>!r.archived&&(!category||itemClassification(r)===category)&&(!classification||itemClassification(r)===classification)&&(!status||r.payload.status===status)&&(!location||r.payload.location===location)&&(!dangerous||(itemClassification(r)!=='Equipment'&&hazardous(r.payload)))&&(!q||text(r.payload).toLocaleLowerCase().includes(q))).sort((a,b)=>itemName(a).localeCompare(itemName(b))||a.id.localeCompare(b.id));
}
export function stockStats(rows,today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'})) {
  const p=rows.filter(r=>!r.archived).map(r=>r.payload);
  return {listed:p.length,needsCheck:p.filter(x=>!x.status||['listed_current','unverified'].includes(x.status)).length,dangerous:rows.filter(r=>!r.archived&&itemClassification(r)!=='Equipment'&&hazardous(r.payload)).length,expired:p.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.expiry_date||'')&&x.expiry_date<today&&!['depleted','disposed','out_of_stock'].includes(x.status)).length};
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
// A source import or record-edit date is not evidence of physical arrival.
export function inventoryArrivalDate(row) {
  const value=row?.payload?.received_date;
  return validDate(value)?value:null;
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
  if(Object.hasOwn(values,'ghs_classification'))next.ghs_classification=(Array.isArray(values.ghs_classification)?values.ghs_classification:text(values.ghs_classification).split(/\r?\n/)).map(text).map(value=>value.trim()).filter(Boolean);
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

/* Product-only manufacturer SDS references. No inventory, stock or member data.
 * A catalog match proposes the supplier document. Bottle identity, regional SDS
 * and handling assessment still require the existing safety review workflow.
 */
const sdsCheckedDate='2026-10-21';
const sdsSigmaBrands=['sigma','sigma-aldrich','aldrich','milliporesigma'];
export const SUPPLIER_SDS_REFERENCES=Object.freeze([
 {id:'aldrich-m6250',brand:'Sigma-Aldrich',brand_aliases:sdsSigmaBrands,catalog_number:'M6250',catalog_aliases:['M6250','M6250-100ML','SI-M6250'],catalog_cas_required:{'SI-M6250':'60-24-2'},name:'2-Mercaptoethanol',cas_numbers:['60-24-2'],form:'liquid',concentration:'≥99.0% as supplied',percentage_values:[99,99.0],product_url:'https://www.sigmaaldrich.com/US/en/product/aldrich/m6250',sds_url:'https://www.sigmaaldrich.com/US/en/sds/aldrich/m6250',sds_version:'8.4',sds_document_date:'2026-06-15',sds_retrieved_date:sdsCheckedDate,sds_region:'US',sds_language:'English',signal_word:'Danger',hazard_codes:['H227','H301','H331','H310','H315','H317','H318','H361','H373','H400','H411'],ghs_classification:['Flammable liquid 4','Acute toxicity: oral 3, inhalation 3, dermal 2','Skin irritation 2','Serious eye damage 1','Skin sensitization 1A','Reproductive toxicity 2','Specific target organ toxicity, repeated exposure 2','Aquatic hazard: acute 1, chronic 2'],note:'US supplier SDS; verify the regional SDS and unchanged supplied product against the bottle.'},
 {id:'aldrich-202908',brand:'Sigma-Aldrich',brand_aliases:sdsSigmaBrands,catalog_number:'202908',catalog_aliases:['202908','202908-10G'],name:'Cadmium chloride',cas_numbers:['10108-64-2'],form:'solid',concentration:'99.99% trace metals basis, as supplied',percentage_values:[99.99],product_url:'https://www.sigmaaldrich.com/US/en/product/aldrich/202908',sds_url:'https://www.sigmaaldrich.com/US/en/sds/aldrich/202908',sds_version:'6.14',sds_document_date:'2026-07-10',sds_retrieved_date:sdsCheckedDate,sds_region:'KR',sds_language:'English',signal_word:'Danger',hazard_codes:['H301','H330','H340','H350','H360','H372','H400','H410'],ghs_classification:['Acute toxicity: oral 3, inhalation 2','Germ cell mutagenicity 1','Carcinogenicity 1','Reproductive toxicity 1','Specific target organ toxicity, repeated exposure 1','Aquatic hazard: acute 1, chronic 1'],note:'The supplier returned a Korean regional SDS at this URL. This is an identified product reference, not a Taiwan regulatory determination.'},
 {id:'biorad-1610158',brand:'Bio-Rad',brand_aliases:['bio-rad','bio rad','biorad'],catalog_number:'1610158',catalog_aliases:['1610158','#1610158','161-0158'],name:'30% Acrylamide/Bis Solution, 37.5:1',cas_numbers:['79-06-1','110-26-9','7732-18-5'],form:'aqueous solution',concentration:'30%, acrylamide:bis 37.5:1, as supplied',percentage_values:[30],ratio:'37.5:1',product_url:'https://www.bio-rad.com/en-gr/product/acrylamide-solutions-powders?ID=5e7a4f31-879c-4d63-ba0b-82556a0ccf1d',sds_url:'https://bio-rad-sds.thewercs.com/DirectDocumentDownloader/Document?prd=HRLS00590~~PDF~~MTR~~AGHS~~EN',sds_version:'4',sds_document_date:'2026-06-09',sds_retrieved_date:sdsCheckedDate,sds_region:'US',sds_language:'English',signal_word:'Danger',hazard_codes:[],ghs_classification:['Acute toxicity, oral 4','Skin irritation 2','Eye irritation 2A','Skin sensitization 1','Germ cell mutagenicity 1B','Carcinogenicity 1B','Reproductive toxicity 1B','Specific target organ toxicity, single exposure 1','Specific target organ toxicity, repeated exposure 1'],note:'US supplier SDS. Hazard codes are not transcribed because this version supplies statements without codes. Its transport text has inconsistent names; no transport fields are copied.'},
 {id:'sigma-e1510',brand:'Sigma-Aldrich',brand_aliases:sdsSigmaBrands,catalog_number:'E1510',catalog_aliases:['E1510','E1510-10ML'],name:'Ethidium bromide solution',cas_numbers:['1239-45-8'],form:'aqueous solution',concentration:'10 mg/mL in water, as supplied',percentage_values:[1],mass_concentration_values:['10mg/ml'],product_url:'https://www.sigmaaldrich.com/ID/en/product/sigma/e1510',sds_url:'https://www.sigmaaldrich.com/US/en/sds/sigma/e1510',sds_version:'6.9',sds_document_date:'2026-05-13',sds_retrieved_date:sdsCheckedDate,sds_region:'US',sds_language:'English',signal_word:'Danger',hazard_codes:['H331','H341'],ghs_classification:['Acute toxicity, inhalation 3','Germ cell mutagenicity 2'],note:'US supplier SDS for the 10 mg/mL aqueous product; do not apply to powder or other solutions. Verify the bottle and regional SDS.'},
 {id:'sigma-a6283',brand:'Sigma-Aldrich',brand_aliases:sdsSigmaBrands,catalog_number:'A6283',catalog_aliases:['A6283','A6283-500ML'],name:'Acetic acid',cas_numbers:['64-19-7'],form:'liquid',concentration:'Glacial, ReagentPlus ≥99%, as supplied',percentage_values:[99],product_url:'https://www.sigmaaldrich.com/US/en/product/sigald/a6283',sds_url:'https://www.sigmaaldrich.com/US/en/sds/sigald/a6283',sds_version:'6.19',sds_document_date:'2026-06-15',sds_retrieved_date:sdsCheckedDate,sds_region:'US',sds_language:'English',signal_word:'Danger',hazard_codes:['H226','H314'],ghs_classification:['Flammable liquid 3','Skin corrosion 1A','Serious eye damage 1'],note:'US supplier SDS for the glacial product. Do not apply to diluted acetic acid. Verify the bottle and regional SDS.'}
].map(reference=>Object.freeze({...reference,brand_aliases:Object.freeze(reference.brand_aliases),catalog_aliases:Object.freeze(reference.catalog_aliases),cas_numbers:Object.freeze(reference.cas_numbers),catalog_cas_required:Object.freeze(reference.catalog_cas_required||{}),mass_concentration_values:Object.freeze(reference.mass_concentration_values||[]),percentage_values:Object.freeze(reference.percentage_values),hazard_codes:Object.freeze(reference.hazard_codes),ghs_classification:Object.freeze(reference.ghs_classification)})));
const sdsString=value=>typeof value==='string'?value.trim():'';
const sdsNormalized=value=>sdsString(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
const sdsCatalog=value=>sdsString(value).normalize('NFKC').toUpperCase();
const sdsEmpty=value=>value==null||value===''||Array.isArray(value)&&value.length===0||['unknown','unverified','not recorded'].includes(sdsNormalized(value));
export function validChemicalCAS(value){if(!/^\d{2,7}-\d{2}-\d$/.test(sdsString(value)))return false;const digits=value.replaceAll('-','');return [...digits.slice(0,-1)].reverse().reduce((n,d,i)=>n+Number(d)*(i+1),0)%10===Number(digits.at(-1));}
function sdsIdentityConflict(payload,reference){
 const values=[payload.name,payload.concentration,payload.concentration_raw,payload.form,payload.phase].map(sdsString).filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
 const cas=sdsString(payload.cas_number);if(validChemicalCAS(cas)&&!reference.cas_numbers.includes(cas))return true;
 const requiredCas=reference.catalog_cas_required?.[sdsCatalog(payload.catalog_number)];if(requiredCas&&cas!==requiredCas)return true;
 for(const match of values.matchAll(/(\d+(?:\.\d+)?)\s*(mg\/m[lL]|g\/l|[μµu]g\/ml)\b/gi)){const concentration=(match[1]+match[2]).toLowerCase().replace(/[μµ]/g,'u');if(!(reference.mass_concentration_values||[]).includes(concentration))return true;}
 for(const match of values.matchAll(/(\d+(?:\.\d+)?)\s*%/g))if(!reference.percentage_values.includes(Number(match[1])))return true;
 const ratios=[...values.matchAll(/\b\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\b/g)].map(m=>m[0].replaceAll(' ',''));
 if(reference.ratio&&ratios.some(ratio=>ratio!==reference.ratio))return true;
 if(/\bdilut\w*\b/.test(values)||!reference.ratio&&ratios.length)return true;
 if(reference.form==='solid'&&/\b(solution|liquid|aqueous|dilut\w*)\b/.test(values))return true;
 if(reference.form!=='solid'&&/\b(powder|solid|crystal\w*)\b/.test(values))return true;
 if(reference.form==='liquid'&&/\b(solution|aqueous|dilut\w*)\b/.test(values))return true;
 return false;
}
export function lookupSafetyReference(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
 const brand=sdsNormalized(payload.brand),code=sdsCatalog(payload.catalog_number);
 if(!brand||!code)return null;
 const matches=SUPPLIER_SDS_REFERENCES.filter(reference=>reference.brand_aliases.includes(brand)&&reference.catalog_aliases.map(sdsCatalog).includes(code)&&!sdsIdentityConflict(payload,reference));
 return matches.length===1?structuredClone(matches[0]):null;
}
export function supplierSafetyPatch(payload,referenceId){
 const reference=lookupSafetyReference(payload);if(!reference||reference.id!==referenceId)throw Error('The supplier SDS does not match this product. Confirm brand, catalogue number, concentration and form.');
 const previous=payload.safety&&typeof payload.safety==='object'&&!Array.isArray(payload.safety)?payload.safety:{};
 if(!sdsEmpty(previous.sds_url)&&previous.sds_url!==reference.sds_url)throw Error('An existing supplier SDS is recorded. Review it before replacing its safety details.');
 if(['reviewed','approved','verified'].includes(sdsNormalized(previous.review_status))||/^\d{4}-\d{2}-\d{2}$/.test(sdsString(previous.sds_review_date)))throw Error('This safety assessment has already been reviewed. Review changes to its supplier SDS explicitly instead of filling it automatically.');
 for(const key of ['sds_version','sds_document_date','sds_region','sds_language','sds_reference_id'])if(!sdsEmpty(previous[key])&&sdsNormalized(previous[key])!==sdsNormalized(key==='sds_reference_id'?reference.id:reference[key]))throw Error('The recorded SDS version or region differs. Review the supplier document before filling details.');
 const sdsCodes=value=>(Array.isArray(value)?value:sdsString(value).split(',')).map(sdsNormalized).filter(Boolean).sort().join('|');
 if(!sdsEmpty(previous.signal_word)&&sdsNormalized(previous.signal_word)!==sdsNormalized(reference.signal_word)||!sdsEmpty(previous.hazard_codes)&&sdsCodes(previous.hazard_codes)!==sdsCodes(reference.hazard_codes)||!sdsEmpty(previous.ghs_classification)&&sdsCodes(previous.ghs_classification)!==sdsCodes(reference.ghs_classification))throw Error('Recorded hazard details differ from this SDS. Review the differences before filling details.');
 const next=structuredClone(previous),fields={signal_word:reference.signal_word,hazard_codes:reference.hazard_codes,ghs_classification:reference.ghs_classification,sds_url:reference.sds_url,sds_version:reference.sds_version,sds_document_date:reference.sds_document_date,sds_retrieved_date:reference.sds_retrieved_date,sds_region:reference.sds_region,sds_language:reference.sds_language,sds_reference_id:reference.id,sds_source_type:'manufacturer_sds',sds_product_number:reference.catalog_number,sds_product_name:reference.name,sds_product_form:reference.form,sds_product_concentration:reference.concentration};
 // Source regulatory classification, reviewer, review date, stock and provenance
 // remain untouched. An SDS reference is not a completed bottle review.
 for(const [key,value] of Object.entries(fields))if(sdsEmpty(next[key]))next[key]=structuredClone(value);
 next.review_status='supplier_sds_pending_bottle_check';
 if(sdsEmpty(next.notes))next.notes=reference.note;
 return next;
}
export function supplierSDSSearchURL(payload){
 const pieces=[sdsString(payload?.brand),sdsString(payload?.catalog_number),sdsString(payload?.name),'safety data sheet'];
 const query=pieces.filter(Boolean).join(' ').slice(0,500);return 'https://www.google.com/search?q='+encodeURIComponent(query);
}
