/* Literal source notes may suggest work without establishing an animal SID.
 * Source-card status is separate from imported observations and follows their
 * identity through a retained cage card. Equipment faults use their own store. */
import {cageCardObservation,createCageObservationContext} from './cage-observations.js?v=100';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const clone=value=>value===undefined?undefined:structuredClone(value);
const historical=row=>row?.history_read_only===true||row?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(row?.record_origin||'');
const current=row=>row&&!row.app_archived_at&&row.archived!==true&&!historical(row)&&!row._derived;
const date=value=>typeof value==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value)&&date(value.slice(0,10))&&Number.isFinite(Date.parse(value));
const taipeiDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function equal(a,b){
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>equal(value,b[i]));
 if(!object(a)||!object(b))return false;
 const fields=Object.keys(a);return fields.length===Object.keys(b).length&&fields.every(field=>Object.hasOwn(b,field)&&equal(a[field],b[field]));
}

/** Conservative suggestions from explicit current notes, never genotype syntax.
 * Preserve only literal supporting clauses in each descriptor. */
export function inferNoteBadges(value){
 if(typeof value!=='string'||!value.trim())return [];
 const found=new Set(),resolvedKinds=new Set(),evidence=new Map();
 const resolve=kind=>{resolvedKinds.add(kind);evidence.delete(kind);};
 const record=(kind,note,again=false)=>{
  found.add(kind);
  if(again){if(resolvedKinds.has(kind))evidence.delete(kind);resolvedKinds.delete(kind);}
  const notes=evidence.get(kind)||[],literal=note.trim();if(literal&&!notes.includes(literal))notes.push(literal);evidence.set(kind,notes);
 };
 for(const clause of value.split(/[;\n\r。；]+|(?<=[.。])\s+/u)){
  if(/\b(?:if|unless|would|could|might|may|whether)\b|(?:如果|假如|若|是否|可能)/i.test(clause))continue;
  // A pointer to another record supplies no pending-work status. Limit this
  // to complete reference clauses so explicit plans in that sheet still count.
  if(/^\s*(?:(?:see(?:\s+also)?|refer\s+to|consult)\s+(?:the\s+)?)?(?:genotyping|geno|experiments?)\s+(?:sheet|tab|table|file|record)(?:\s+for\s+(?:details|results|information))?\s*[.!]?\s*$/i.test(clause))continue;
  const mentions=[...clause.matchAll(/\b(genotyping|genotyped|genotype|geno|experiments?|pir|led)\b/gi)];
  for(const [i,match]of mentions.entries()){
   const word=match[0].toLowerCase(),kind=/^geno/.test(word)?'genotyping':/^experiment/.test(word)?'experiment':word;
   const before=clause.slice(i?mentions[i-1].index+mentions[i-1][0].length:0,match.index),after=clause.slice(match.index+match[0].length,mentions[i+1]?.index??clause.length),scope=before+match[0]+after;
   // Keep an adjacent action prefix, but exclude other cells, identities and
   // another badge's preceding status from the editable evidence note.
   const prefix=kind==='genotyping'?before.match(/\b(?:needs?(?:\s+to\s+be)?|pending|awaiting|not(?:\s+yet)?|never|to\s+be)\s*$/i)?.[0]||'':kind==='experiment'?before.match(/\b(?:for|planned|planning|needs?|pending|awaiting)\s*$/i)?.[0]||'':'';
   const supporting=prefix+match[0]+(mentions[i+1]?after.replace(/(?:\s*[,，:&/]\s*|\s+\b(?:and|or|but)\b\s*)+$/i,''):after);
   if(kind==='genotyping'){
    const pending=/\b(?:not\s+yet|not|never)\s+genotyped\b|\b(?:need(?:s|ed)?|pending|awaiting|to\s+be)\b[^.;]*\b(?:genotyp(?:e|ed|ing)|geno)\b|\b(?:genotyp(?:e|ed|ing)|geno)\b\s*(?:is\s+)?(?:pending|required|needed)\b/i.test(scope);
    const negated=/\b(?:no\s+(?:need(?:\s+\w+){0,3}\s+)?|not\s+|without\s+|skip\s+|do\s+not\s+)(?:genotyping|genotype|geno)\b|\b(?:genotyping|genotype|geno)\b[^.;]*\b(?:not\s+(?:needed|required)|unnecessary)\b/i.test(scope);
    const resolved=/\b(?:done|completed?|finished|received|results?)\b/i.test(after)||/\b(?:done|completed?|finished)\s*$/i.test(before)||word==='genotyped'&&!pending;
    if(negated||resolved)resolve(kind);
    if(!negated&&!resolved&&(pending||word==='genotyping'||word==='geno'))record(kind,supporting,/\bagain\b/i.test(scope));
   }else if(kind==='experiment'){
    const negated=/\b(?:no|without|skip|cancel(?:led|ed)?)\b[^.;]*\bexperiments?\b|\bexperiments?\b[^.;]*\b(?:not\s+(?:planned|needed|required)|cancel(?:led|ed)?|completed?|finished|done|results?|analysis)\b/i.test(scope)||/\b(?:completed?|finished|previous|past)\s*$/i.test(before);
    if(negated)resolve(kind);else record(kind,supporting,/\bagain\b/i.test(scope));
   }else{
    const affirmative=after.replace(/\b(?:not\s*work(?:ing)?|does\s+not\s+work|doesn't\s+work)\b/gi,'');
    const clearPrefix=/\bno\s*$/i.test(before)&&/^\s+(?:problems?|faults?)\b/i.test(after);
    const resolved=clearPrefix||/\b(?:not\s*(?:bad|broken|faulty)|no\s+(?:problems?|faults?)|works?|working\s+(?:fine|well|normally)|repaired|fixed|resolved|normal|okay|ok)\b|(?:沒(?:有)?問題|没有问题|沒壞|没坏|已修好|已修復|已修复|正常|已恢復|已恢复)/i.test(affirmative)||/\b(?:repaired|fixed)\s*$/i.test(before);
    const fault=/^\s*[!！]|\b(?:not\s*(?:good|work(?:ing)?|functional)|does\s+not\s+work|doesn't\s+work|broken|bad|faulty|failed|fails?|failure|malfunction(?:ing)?)\b|(?:壞|坏|故障|不亮|失靈|失灵|無訊號|无信号|不工作)/i.test(after);
    if(resolved)resolve(kind);
    if(fault&&!resolved)record(kind,supporting,/\bagain\b/i.test(after));
   }
  }
  if(/(?:不需|無需|无需|已完成)(?:基因)?分型|(?:基因)?分型完成/.test(clause))resolve('genotyping');
  else {const match=clause.match(/(?:待|尚未|還沒|还没|需(?:要)?)(?:基因)?分型|(?:基因)?分型待完成/);if(match)record('genotyping',match[0]);}
  if(/(?:沒有|没有|無|无|取消|完成|結束|结束)(?:安排)?(?:實驗|实验)/.test(clause))resolve('experiment');
  else {const match=clause.match(/(?:待|安排|預計|预计|用於|用于|供)(?:做)?(?:實驗|实验)/);if(match)record('experiment',match[0]);}
 }
 return ['genotyping','experiment','pir','led'].filter(kind=>found.has(kind)&&!resolvedKinds.has(kind)).map(kind=>({kind,note:(evidence.get(kind)||[]).join('\n').slice(0,600)}));
}

/** Header/footer cell values and comments stay literal. A row's own notes may
 * be excluded by value, including each line of its combined cell/comment note. */
export function noteTextsFromPosition(position,{exclude=[]}={}){
 const omitted=new Set(Array.from(exclude||[]).flatMap(value=>typeof value==='string'?[value,...value.split(/[\r\n]+/)]:[]).map(text)),notes=[];
 for(const line of text(position?.source_block_text).split(/[\r\n]+/)){
  const match=line.match(/^([A-Z]{1,3}[1-9]\d{0,5})(?: comment)?:[ \t]?(.*)$/);if(!match)continue;
  const value=match[2];if(!text(value)||omitted.has(text(value))||omitted.has(match[1]))continue;
  notes.push(value.slice(0,600));if(notes.length===200)break;
 }
 return notes;
}

// Coordinates, literal tag, DOB and sex distinguish a row cohort. Notes,
// capture times, manager, lux and ear-mark corrections do not change its owner.
const identityTuple=animal=>[text(animal?.sourceCell)||null,text(animal?.sourceTag||animal?.tag),date(animal?.dateOfBirth)?animal.dateOfBirth:null,/^(?:male|m)$/i.test(text(animal?.sex))?'Male':/^(?:female|f)$/i.test(text(animal?.sex))?'Female':null];
function identityObservation(observation){
 if(!object(observation)||observation.schemaVersion!==1||!Array.isArray(observation.animals)||observation.animals.length>100)return null;
 const tuples=observation.animals.map(identityTuple);
 if(tuples.some(tuple=>!tuple[1]))return null;
 return {tuples,started:date(observation.startedDate)?observation.startedDate:null};
}
function eventId(locationId,anchor){
 const input=JSON.stringify([locationId,anchor]);let hash=0xcbf29ce484222325n;
 for(let i=0;i<input.length;i++){hash^=BigInt(input.charCodeAt(i));hash=BigInt.asUintN(64,hash*0x100000001b3n);}
 return 'cage-source-badges:'+hash.toString(16).padStart(16,'0');
}
/** Returns null for a missing or ambiguous literal row; this is no SID link. */
export function sourceBadgeTarget(sourceLocationId,observation,animal=null){
 const locationId=text(sourceLocationId),identity=identityObservation(observation);if(!locationId||!identity||!identity.tuples.length)return null;
 let tuple=null;
 if(animal!==null){
  if(!object(animal))return null;
  const wanted=identityTuple(animal),exact=identity.tuples.filter(row=>equal(row,wanted));
  // A linked display may contain deliberate DOB/sex overrides. Select the
  // literal source row by its cell and sourceTag, then use its original tuple.
  const candidates=exact.length?exact:identity.tuples.filter(row=>row[0]===wanted[0]&&row[1]===wanted[1]);
  if(candidates.length!==1)return null;tuple=candidates[0];
 }
 const anchor=JSON.stringify(tuple?['row',identity.started,tuple]:['card',identity.started,[...identity.tuples].sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;})]);
 return {type:'source_cards',id:eventId(locationId,anchor),name:tuple?tuple[1]:'Card note',source:{location_id:locationId,anchor}};
}

function validateBadges(value){
 const errors=[];if(!Array.isArray(value))return ['Source work badges must be an array.'];
 if(value.length>12)errors.push('Keep at most 12 work badges on one source card.');
 const seen=new Set(),allowed=new Set(['kind','label','status','note','assignee','due_date','updated_at']);
 for(const row of value){
  if(!object(row)){errors.push('A source work badge must be a record.');continue;}
  if(!['genotyping','experiment','other'].includes(row.kind))errors.push('Source cards support genotyping, experiment, or other work.');
  if(seen.has(row.kind))errors.push('Record each source work badge kind only once.');seen.add(row.kind);
  if(Object.keys(row).some(key=>!allowed.has(key)))errors.push('Source work badge contains unsupported fields.');
  if(!['open','in_progress','done'].includes(row.status))errors.push('Choose open, in progress, or done.');
  if(row.label!==undefined&&(typeof row.label!=='string'||row.label.length>40)||row.kind!=='other'&&text(row.label))errors.push('Only Other uses a custom label of at most 40 characters.');
  for(const [field,max]of [['note',600],['assignee',160]])if(row[field]!==undefined&&(typeof row[field]!=='string'||row[field].length>max))errors.push(`Source badge ${field} must be text of at most ${max} characters.`);
  if(row.due_date!==undefined&&row.due_date!==null&&!date(row.due_date))errors.push('Source badge due date must be YYYY-MM-DD or blank.');
  if(!timestamp(row.updated_at))errors.push('Source badge update time must include a valid UTC offset.');
 }
 return errors;
}
function validTarget(target){
 return object(target)&&target.type==='source_cards'&&object(target.source)&&typeof target.source.location_id==='string'&&text(target.source.location_id)===target.source.location_id&&Boolean(target.source.location_id)&&typeof target.source.anchor==='string'&&target.source.anchor.length<=40000&&target.id===eventId(target.source.location_id,target.source.anchor);
}
function validEvent(event){
 const payload=event?.card_badge_status;
 return current(event)&&event.event_type==='cage_card_badge_status'&&event.record_origin==='app_created'&&typeof event.location_id==='string'&&Boolean(event.location_id)&&object(payload)&&payload.schemaVersion===1&&typeof payload.anchor==='string'&&payload.anchor.length<=40000&&event.event_id===eventId(event.location_id,payload.anchor)&&date(event.event_date)&&validateBadges(payload.work_badges).length===0;
}
/** Build once per render. Duplicate event IDs fail closed. */
export function buildSourceBadgeIndex(dataset){
 const index=new Map();if(dataset?.history_projection?.read_only===true)return index;
 const groups=new Map();
 for(const event of list(dataset?.tables?.husbandry_events)){
  if(!text(event?.event_id))continue;const group=groups.get(event.event_id)||[];group.push(event);groups.set(event.event_id,group);
 }
 for(const [id,group]of groups)if(group.length===1&&validEvent(group[0]))index.set(id,group[0]);
 return index;
}
export function sourceBadgeRows(indexOrDataset,target){
 if(!validTarget(target))return [];
 const index=indexOrDataset instanceof Map?indexOrDataset:buildSourceBadgeIndex(indexOrDataset),event=index.get(target.id);
 return validEvent(event)&&event.location_id===target.source.location_id&&event.card_badge_status.anchor===target.source.anchor?clone(event.card_badge_status.work_badges):[];
}

function requireCurrentTarget(dataset,target){
 if(dataset?.history_projection?.read_only===true)throw new Error('Historical cages are read only.');
 if(!validTarget(target))throw new Error('Choose a current literal source card or animal row.');
 const ctx=createCageObservationContext(dataset),groups=new Map();
 for(const position of list(dataset?.tables?.locations)){
  const id=text(position?.location_id);if(!id)continue;const rows=groups.get(id)||[];rows.push(position);groups.set(id,rows);
 }
 const matches=card=>{
  if(card.source_location_id!==target.source.location_id)return false;
  const cardTarget=sourceBadgeTarget(card.source_location_id,card.observation);
  if(cardTarget?.source.anchor===target.source.anchor)return true;
  return list(card.observation?.animals).some(animal=>sourceBadgeTarget(card.source_location_id,card.observation,animal)?.source.anchor===target.source.anchor);
 };
 const retained=ctx.currentCages.filter(cage=>ctx.card(cage)?.source_location_id===target.source.location_id),possibleLocations=new Set([target.source.location_id,...retained.map(cage=>text(cage.location_id))]);
 for(const locationId of possibleLocations){
  const positions=groups.get(locationId)||[];
  if(positions.length!==1)continue;const position=positions[0];
  if(!current(position)||position.source_current===false)continue;
  if(matches(cageCardObservation(dataset,{position},ctx)))return;
  // Explicitly inspect each retained card at its current physical position.
  for(const cage of retained)if(text(cage.location_id)===text(position.location_id)&&matches(cageCardObservation(dataset,{position,cage},ctx)))return;
 }
 throw new Error('The source card identity changed or is no longer current. Review the current card before saving.');
}
function storedEvent(dataset,target){
 const rows=list(dataset?.tables?.husbandry_events).filter(row=>row?.event_id===target.id);
 if(rows.length>1)throw new Error('This source card has conflicting status records. Reload before editing.');
 const event=rows[0];
 if(event&&(!validEvent(event)||event.location_id!==target.source.location_id||event.card_badge_status.anchor!==target.source.anchor))throw new Error('This source status record is unavailable or belongs to another card.');
 return event||null;
}
export function planSourceBadgeEdit(dataset,target,badge,{at=new Date().toISOString()}={}){
 if(!timestamp(at))throw new Error('Choose a valid badge update time.');
 requireCurrentTarget(dataset,target);const existing=storedEvent(dataset,target);
 if(!object(badge))throw new Error('Choose a source work badge.');
 const row={kind:badge.kind,status:badge.status,note:badge.note??'',assignee:badge.assignee??'',due_date:badge.due_date===undefined||badge.due_date===''?null:badge.due_date,updated_at:at,...(badge.kind==='other'?{label:badge.label??''}:{})};
 const errors=validateBadges([{...badge,...row}]);if(errors.length)throw new Error(errors.join(' '));
 const rows=clone(existing?.card_badge_status.work_badges||[]),offset=rows.findIndex(value=>value.kind===row.kind),label=row.kind==='other'?text(row.label)||'Other':row.kind==='genotyping'?'Genotyping':'Experiment',summary=`${label}: ${row.status.replaceAll('_',' ')}`;
 if(offset>=0&&equal({...rows[offset],updated_at:at},row))return {changes:[],summary};
 if(offset<0)rows.push(row);else rows[offset]=row;
 const checked=validateBadges(rows);if(checked.length)throw new Error(checked.join(' '));
 const latest=rows.reduce((latest,row)=>Date.parse(row.updated_at)>Date.parse(latest)?row.updated_at:latest,at);
 const event={...(existing?clone(existing):{event_id:target.id,event_type:'cage_card_badge_status',record_origin:'app_created',location_id:target.source.location_id}),event_date:taipeiDay(latest),card_badge_status:{...(existing?clone(existing.card_badge_status):{}),schemaVersion:1,anchor:target.source.anchor,work_badges:rows}};
 return {changes:[{type:'husbandry_events',id:target.id,field:'$source_badges',base:clone(existing),value:event}],summary};
}
const sourceDrafts=changes=>Array.from(changes||[]).filter(row=>row?.field==='$source_badges');
export function validateSourceBadgeDrafts(dataset,changes,{canEdit=()=>true}={}){
 const errors=[],drafts=sourceDrafts(changes),seen=new Set();if(!drafts.length)return errors;
 if(dataset?.history_projection?.read_only===true)errors.push('Historical cages are read only.');
 if(!canEdit('cages')||!canEdit('locations'))errors.push('Housing edit permission is required to save source work badges.');
 for(const draft of drafts){
  const value=draft.value,payload=value?.card_badge_status;
  if(draft.type!=='husbandry_events'||!validEvent(value)||draft.id!==value.event_id){errors.push('Invalid source work badge draft.');continue;}
  if(seen.has(draft.id)){errors.push('Save each source status record only once.');continue;}seen.add(draft.id);
  const target={type:'source_cards',id:draft.id,source:{location_id:value.location_id,anchor:payload.anchor}};
  try{
   requireCurrentTarget(dataset,target);const existing=storedEvent(dataset,target);
   if(!equal(existing,value)&&!equal(existing,draft.base))errors.push('The source badge status changed. Review the draft before saving.');
   if(existing&&(!equal({...existing,event_date:value.event_date,card_badge_status:payload},value)||!equal({...existing.card_badge_status,work_badges:payload.work_badges},payload))||!existing&&(value.record_origin!=='app_created'||Object.keys(value).some(key=>!['event_id','event_type','event_date','record_origin','location_id','card_badge_status'].includes(key))||Object.keys(payload).some(key=>!['schemaVersion','anchor','work_badges'].includes(key))))errors.push('A source badge draft cannot change unrelated record metadata.');
   const latest=payload.work_badges.map(row=>row.updated_at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
   if(latest&&value.event_date!==taipeiDay(latest))errors.push('Source status date must match its latest badge update.');
  }catch(error){errors.push(error.message);}
 }
 return [...new Set(errors)];
}
/** Validate every source draft before replacing any event. Source data is intact. */
export function applySourceBadgeDrafts(dataset,changes,{canEdit=()=>true}={}){
 const drafts=sourceDrafts(changes),errors=validateSourceBadgeDrafts(dataset,drafts,{canEdit});if(errors.length)throw new Error(errors.join(' '));
 if(!drafts.length)return dataset;
 const replacements=new Map(drafts.map(row=>[row.id,clone(row.value)])),events=list(dataset?.tables?.husbandry_events).map(row=>{const replacement=replacements.get(row.event_id);if(!replacement)return row;replacements.delete(row.event_id);return replacement;});
 return {...dataset,tables:{...dataset?.tables,husbandry_events:[...events,...replacements.values()]}};
}

/** The write transaction must fence the observations used to validate a draft,
 * including the cage and physical destination of a retained moved card. */
export function sourceBadgeReadDependencies(dataset,changes){
 const dependencies=new Map(),add=(type,id)=>{if(text(id))dependencies.set(type+':'+text(id),{type,id:text(id)});};
 const drafts=sourceDrafts(changes);if(!drafts.length)return [];
 const ctx=createCageObservationContext(dataset);
 for(const draft of drafts){
  const event=draft.value,payload=event?.card_badge_status,target={type:'source_cards',id:draft.id,source:{location_id:event?.location_id,anchor:payload?.anchor}};
  if(!validTarget(target))continue;
  add('locations',target.source.location_id);
  const matches=card=>card.source_location_id===target.source.location_id&&(sourceBadgeTarget(card.source_location_id,card.observation)?.id===target.id||list(card.observation?.animals).some(animal=>sourceBadgeTarget(card.source_location_id,card.observation,animal)?.id===target.id));
  for(const cage of ctx.currentCages){
   const position=ctx.locations.get(text(cage.location_id));if(!current(position)||position.source_current===false)continue;
   if(matches(cageCardObservation(dataset,{position,cage},ctx))){add('cages',cage.cage_sid);add('locations',position.location_id);}
  }
 }
 return [...dependencies.values()];
}
