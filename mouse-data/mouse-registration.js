import { parseCompactStrainNotation } from './mouse-summary.js?v=146';
import { cageSheetAnimals, ageWeeks, todayTaipei } from './cage-observations.js?v=100';
import { getBreedingOptions } from './breeding-options.js?v=100';
import { cageManager, buildCageLocationEvent, validateRecord } from './model.js?v=174';
import {FOXJ1_STRAIN_NAME} from './strain-registry.js?v=146';
import {formatMouseSid} from './mouse-sid.js?v=188';

const active=r=>r&&!r.archived&&!r.app_archived_at&&!r.history_read_only&&!r.source_historical;
const mice=data=>data?.tables?.mice||[];
const find=(data,type,key,id)=>(data?.tables?.[type]||[]).find(r=>String(r[key])===String(id));
const names={P:'PER2::LUC',E:'Bmal1-ELuc',B:'Bmal1-flox',F:FOXJ1_STRAIN_NAME,V:'Vip-Cre',AD:'APP/PS1',A:'Avp-Cre',Vg:'Vgat-flox',32:'Ai32',96:'Ai96',Gt:'GAD67-tTA2',WT:'WT'};

const numericSid=value=>/^\d+$/.test(String(value))?BigInt(String(value)):null;
const mouseSidAliases=mouse=>[mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])];

/** Local previews continue the imported SoftMouse sequence. Shared registration
 * uses the server reservation instead; a preview never reserves an identifier. */
export function nextNumericMouseSids(dataset,count=1) {
 if(!Number.isSafeInteger(count)||count<1||count>100)throw new Error('Choose between 1 and 100 mice per batch.');
 const used=new Set(),source=mice(dataset);let next=1n;
 for(const mouse of source){
  for(const alias of mouseSidAliases(mouse)){const value=numericSid(alias);if(value!==null)used.add(String(value));}
  const value=numericSid(mouse.mouse_sid),canonical=/^\d{5}$/.test(mouse.canonical_sid||'')?numericSid(mouse.canonical_sid):null;
  if(canonical!==null&&canonical>0n&&canonical>=next)next=canonical+1n;
  if(value!==null&&value>0n&&value<=99999n&&!['app_created','animal_sheet_tag_dob_cohort'].includes(mouse.record_origin)&&value>=next)next=value+1n;
 }
 const result=[];
 while(result.length<count){if(next>99999n)throw new Error('The five-digit mouse SID range is full. Contact the colony administrator.');const value=String(next++);if(!used.has(value)){result.push(formatMouseSid(value));used.add(value);}}
 return result;
}

export function newNumericMouseSid(dataset) {return nextNumericMouseSids(dataset,1)[0];}

export const MOUSE_BATCH_LIMIT=100;
const batchSexes=['Male','Female','Unknown'];
const batchField={Male:'batch_males',Female:'batch_females',Unknown:'batch_unknown'};
const escapeHTML=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function mouseBatchCountsHTML(defaultSex='Unknown') {
 const sex=batchSexes.includes(defaultSex)?defaultSex:'Unknown';
 return `<fieldset class="field wide mouse-batch-counts"><legend>Number of mice</legend><p class="small muted">Enter the number of males, females and unsexed mice. The information below applies to the whole batch. SIDs are assigned automatically.</p><div class="form-grid">${batchSexes.map(value=>`<div class="field"><label for="${batchField[value]}">${value==='Unknown'?'Unsexed':value==='Male'?'Males':'Females'}</label><input id="${batchField[value]}" name="${batchField[value]}" type="number" min="0" max="${MOUSE_BATCH_LIMIT}" step="1" value="${value===sex?1:0}" inputmode="numeric"></div>`).join('')}</div><p class="small muted">For several mice, enter a tag prefix such as FB. Each mouse receives its own tag and SID.</p></fieldset>`;
}

/** Accept FormData or a plain object. Fractional, negative and blank counts are
 * rejected before any identifier reservation or record write. */
export function readMouseBatchCounts(source) {
 const result={};
 for(const sex of batchSexes){const key=batchField[sex],value=typeof source?.get==='function'?source.get(key):source?.[sex]??source?.[key];
  if(typeof value!=='number'&&typeof value!=='string'||!/^\d+$/.test(String(value)))throw new Error('Enter a whole number of mice for each sex.');
  const count=Number(value);if(!Number.isSafeInteger(count)||count<0||count>MOUSE_BATCH_LIMIT)throw new Error(`Enter between 0 and ${MOUSE_BATCH_LIMIT} mice for each sex.`);result[sex]=count;
 }
 const total=batchSexes.reduce((sum,sex)=>sum+result[sex],0);
 if(total<1||total>MOUSE_BATCH_LIMIT)throw new Error(`Choose between 1 and ${MOUSE_BATCH_LIMIT} mice per batch.`);
 return result;
}

/** Build and validate each animal without changing the source dataset. Shared
 * fields are deep copied so an individual can be edited safely after creation. */
export function buildMouseBatchDrafts(dataset,sharedDraft,counts,{sids=null,requestId=sharedDraft?.registration_request_id}={}) {
 const parsed=readMouseBatchCounts(counts),total=batchSexes.reduce((sum,sex)=>sum+parsed[sex],0);
 const assigned=sids??nextNumericMouseSids(dataset,total);
 if(!Array.isArray(assigned)||assigned.length!==total||assigned.some(id=>typeof id!=='string'||!/^\d{5}$/.test(id)||BigInt(id)<1n)||new Set(assigned.map(id=>String(BigInt(id)))).size!==total)throw new Error('The SID reservation does not match this batch. Reopen the draft.');
 const occupied=new Set(mice(dataset).flatMap(mouseSidAliases).map(numericSid).filter(value=>value!==null).map(String));
 if(assigned.some(id=>occupied.has(String(BigInt(id)))))throw new Error('A reserved SID already exists. Refresh before registering the batch.');
 const rawTag=String(sharedDraft?.physical_tag||'').trim();
 if(total>1&&/[-\s][MFU]\s*\d+$/i.test(rawTag))throw new Error('For several mice, enter a shared tag prefix such as FB instead of a complete numbered tag.');
 const staged=structuredClone(dataset),drafts=[],dependencies=new Map(),warnings=[];
 let index=0;
 for(const sex of batchSexes)for(let number=0;number<parsed[sex];number++){
  const sid=assigned[index],draft={...structuredClone(sharedDraft),mouse_sid:sid,sex};
  if(requestId)draft.registration_request_id=total===1?requestId:`${requestId}:${index+1}`;
  draft.physical_tag=total>1?(rawTag?`${rawTag}-${sex==='Unknown'?'U':sex[0]}${sid}`:null):completeMouseTag(rawTag,sex,sid)||null;
  if(draft.genotype_inference?.basis==='physical_tag')draft.genotype_inference={...draft.genotype_inference,tag:draft.physical_tag};
  const identity=separateReusedMouseTag(staged,draft);if(identity.error)throw new Error(`Mouse ${index+1}: ${identity.error}`);
  for(const dependency of identity.readDependencies)dependencies.set(dependency.type+':'+dependency.id,dependency);
  const validation=validateRecord('mice',identity.draft,staged);
  if(validation.errors.length)throw new Error(`Mouse ${index+1} (SID ${sid}): ${validation.errors.join(' ')}`);
  warnings.push(...validation.warnings);drafts.push(identity.draft);staged.tables.mice.push(identity.draft);index++;
 }
 return {drafts,readDependencies:[...dependencies.values()],warnings:[...new Set(warnings)]};
}

export function mouseBatchPreviewHTML(drafts) {
 return `<h3>Review ${drafts.length} ${drafts.length===1?'mouse':'mice'}</h3><div class="table-scroll"><table><thead><tr><th>SID</th><th>Sex</th><th>Physical tag</th><th>Date of birth</th><th>Genotype</th></tr></thead><tbody>${drafts.map(draft=>`<tr><td>${escapeHTML(draft.mouse_sid)}</td><td>${escapeHTML(draft.sex)}</td><td>${escapeHTML(draft.physical_tag||'—')}</td><td>${escapeHTML(draft.date_of_birth||'Unknown')}</td><td>${escapeHTML(draft.genotype||'Unknown')}</td></tr>`).join('')}</tbody></table></div>`;
}

export function inferMouseTag(tag) {
 const raw=String(tag||'').trim(),match=raw.match(/^(.*?)[-\s]([MF])\s*(\d+)$/);
 const entries=/^\d+$/.test(raw)?null:parseCompactStrainNotation(match?match[1]:raw);
 if(!entries?.length)return {sex:match?match[2]==='M'?'Male':'Female':null,genotype:null,prefix:null};
 const genotype=entries.map(e=>{
  const name=names[e.code]||e.code;if(e.code==='WT')return 'WT';
  if(e.presence==='uncertain')return `${name} (undetermined)`;
  if(e.dosageUncertain)return `${name} (zygosity undetermined)`;
  const floxed=['B','Vg'].includes(e.code),dose=e.dosage==='homozygous'?(floxed?'fl/fl':'+/+'):(floxed?'fl/+':'+/-');
  return `${name} (${dose})`;
 }).join('; ');
 return {sex:match?match[2]==='M'?'Male':'Female':null,genotype,prefix:match?match[1]:raw,tagNumber:match?.[3]||null};
}

/** A reused physical tag identifies a different animal only with an explicit,
 * different DOB. Keep the original spelling as an alias for source imports. */
export function separateReusedMouseTag(dataset,draft) {
 const tag=String(draft.physical_tag||'').trim(),dob=draft.date_of_birth;
 const key=t=>String(t||'').trim().replace(/^(.*?)(?:\s+|-)([MF]\d+)$/,'$1-$2');
 const numberKey=t=>key(t).replace(/([-][MF])0*(\d+)$/,'$1$2');
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 const identifiers=m=>{
  const raw=String(m.physical_tag||'').trim(),sid=String(m.mouse_sid||''),values=[raw,...(Array.isArray(m.physical_tag_aliases)?m.physical_tag_aliases:[]).filter(t=>typeof t==='string')];
  if(/^\d+$/.test(sid)&&/[-\s][MF]$/.test(raw))values.push(raw+sid);
  if(/^\d+$/.test(sid)&&['Male','Female'].includes(m.sex)&&raw&&parseCompactStrainNotation(raw)?.length)values.push(`${raw}-${m.sex[0]}${sid}`);
  return [...new Set(values.filter(Boolean).map(key))];
 };
 // Leading-zero equivalence is used only to prevent duplicate registrations;
 // source matching still requires literal aliases and the exact DOB.
 const matches=mice(dataset).filter(m=>String(m.mouse_sid)!==String(draft.mouse_sid)&&identifiers(m).some(t=>numberKey(t)===numberKey(tag)));
 if(!tag||!matches.length)return {draft,readDependencies:[],error:null};
 const dependencies=matches.map(m=>({type:'mice',id:String(m.mouse_sid)}));
 if(!validDate(dob)||matches.some(m=>!validDate(m.date_of_birth)))return {draft,readDependencies:dependencies,error:'This tag already exists. Both dates of birth must be valid to distinguish the mice.'};
 const same=matches.find(m=>m.date_of_birth===dob);
 if(same)return {draft,readDependencies:dependencies,error:`This tag and DOB already belong to SID ${same.mouse_sid}. Open that mouse instead.`};
 const exact=matches.some(m=>identifiers(m).includes(key(tag)));
 const suffix=tag.match(/^(.*?[-\s][MF])(\d{1,6})$/);
 if(exact&&!suffix)return {draft,readDependencies:dependencies,error:'This reused tag needs a distinct physical tag before saving.'};
 const padded=exact?`${suffix[1]}0${suffix[2]}`:tag;
 if(exact&&mice(dataset).some(m=>identifiers(m).includes(key(padded))))return {draft,readDependencies:dependencies,error:'The padded tag already exists. Review this mouse before creating another record.'};
 const aliases=exact?[tag]:matches.flatMap(identifiers).filter(t=>numberKey(t)===numberKey(tag));
 return {draft:{...draft,physical_tag:padded,physical_tag_aliases:[...new Set([...(Array.isArray(draft.physical_tag_aliases)?draft.physical_tag_aliases:[]),...aliases])]},readDependencies:dependencies,error:null};
}

export function completeMouseTag(tag,sex,sid) {
 const raw=String(tag||'').trim(),info=inferMouseTag(raw);
 return info.prefix&&!info.tagNumber&&['Male','Female'].includes(sex)?`${raw}-${sex[0]}${sid}`:raw;
}

export function cageBreedingLayout(dataset,item,rows,{asOf=todayTaipei()}={}) {
 const options=getBreedingOptions(dataset),cageId=item.cage?.cage_sid||item.cageId;
 const matings=(dataset?.tables?.matings||[]).filter(r=>active(r)&&r.state==='Active'&&String(r.cage_sid)===String(cageId)&&(!r.set_up_date||r.set_up_date<=asOf)&&(!r.disbanded_date||r.disbanded_date>asOf));
 const explicit=new Set(matings.flatMap(r=>[...(r.male_sids||[]),...(r.female_sids||[])]).map(String));
 const adult=row=>{const weeks=ageWeeks(row.dateOfBirth,asOf);return ['Male','Female'].includes(row.sex)&&(explicit.has(String(row.mouseSid))||weeks!==null&&weeks>=options[row.sex==='Male'?'male_min_weeks':'female_min_weeks']);};
 const males=rows.filter(r=>adult(r)&&r.sex==='Male'),females=rows.filter(r=>adult(r)&&r.sex==='Female');
 const isBreeding=males.length>0&&females.length>0;
 if(!isBreeding)return {rows:[...rows],parentCount:0,sireIds:[],damIds:[],isBreeding:false};
 const parents=[...males,...females],linked=group=>group.every(r=>r.mouseSid&&['matched','registered'].includes(r.matchStatus))?[...new Set(group.map(r=>String(r.mouseSid)))]:[];
 return {rows:[...parents,...rows.filter(r=>!parents.includes(r))],parentCount:parents.length,sireIds:linked(males),damIds:linked(females),isBreeding:true};
}

export function prepareCageMouseRegistration(dataset,{cageSid=null,positionId=null,newborn=false}={}) {
 if(dataset?.history_projection?.read_only)throw new Error('Return to current cages before adding mice.');
 const position=positionId?find(dataset,'locations','location_id',positionId):null;
 if(positionId&&(!active(position)||position.source_current===false||position.active===false))throw new Error('This cage position is unavailable.');
 let cage=cageSid?find(dataset,'cages','cage_sid',cageSid):null;
 if(cage&&!active(cage)||cage&&!['Active','Occupied'].includes(cage.state))throw new Error('Choose an active cage.');
 const atPosition=position?(dataset.tables.cages||[]).filter(c=>active(c)&&['Active','Occupied'].includes(c.state)&&c.location_id===positionId):[];
 if(atPosition.length>1||cage&&position&&cage.location_id!==positionId)throw new Error('The cage position needs review.');
 if(!cage&&atPosition.length)cage=atPosition[0];
 if(!cage&&!position)throw new Error('Choose a current cage or rack position.');
 const residentRows=cage?mice(dataset).filter(m=>active(m)&&m.state==='Stock'&&String(m.cage_sid)===String(cage.cage_sid)):[];
 const item={cage,position,cageId:cage?.cage_sid,locationId:positionId,mice:residentRows};
 const layout=cageBreedingLayout(dataset,item,cageSheetAnimals(dataset,item));
 const assigned=cage?cageManager(cage,mice(dataset)).name:position.manager||position.source_cage_observation?.managerName||position.source_manager_name||null;
 const newCage=!cage?{cage_sid:'CAGE-'+crypto.randomUUID(),cage_tag:position.label||position.location_id,state:'Active',record_origin:'app_created',manager:assigned,location_id:position.location_id,room_id:position.room_id,rack_id:position.rack_id,cage_sheet_source_location_id:position.location_id}:null;
 cage=cage||newCage;
 const parents=newborn&&layout.isBreeding?{sire_sids:layout.sireIds,dam_sids:layout.damIds}:{sire_sids:[],dam_sids:[]};
 const dependencies=[...residentRows.map(m=>({type:'mice',id:String(m.mouse_sid)})),...parents.sire_sids.concat(parents.dam_sids).map(id=>({type:'mice',id}))];
 for(const [type,key,row] of [['cages','cage_sid',newCage?null:cage],['locations','location_id',position],['rooms','room_id',find(dataset,'rooms','room_id',cage.room_id)],['racks','rack_id',find(dataset,'racks','rack_id',cage.rack_id)]])if(row)dependencies.push({type,id:String(row[key])});
 const readDependencies=[...new Map(dependencies.map(d=>[d.type+':'+d.id,d])).values()];
 const guarded=readDependencies.map(d=>({type:d.type,id:d.id,payload:structuredClone(find(dataset,d.type,{mice:'mouse_sid',cages:'cage_sid',locations:'location_id',rooms:'room_id',racks:'rack_id'}[d.type],d.id))}));
 return {newCage,positionId:position?.location_id||null,readDependencies,guarded,newborn,
  prefill:{cage_sid:cage.cage_sid,cage_tag:cage.cage_tag,manager:assigned,...parents,...(newborn?{date_of_birth:todayTaipei(),mouse_slot_role:'offspring',lineage_basis:{kind:'cage_parent_candidates',recorded_on:todayTaipei(),cage_sid:cage.cage_sid}}:{} )}};
}

export function registrationDataset(dataset,registration) {
 if(!registration?.newCage)return dataset;
 return {...dataset,tables:{...dataset.tables,cages:[...(dataset.tables.cages||[]),registration.newCage]}};
}

export function mouseRegistrationDependencies(dataset,draft,registration=null,before=null) {
 const result=new Map((registration?.readDependencies||[]).map(d=>[d.type+':'+d.id,d]));
 const add=(type,key,id)=>{if(!id)return;const row=find(dataset,type,key,id);if(!active(row))throw new Error('A parent or cage is unavailable. Reload before saving.');result.set(type+':'+id,{type,id:String(id)});return row;};
 const priorParents=new Set([...(before?.sire_sids||[]),...(before?.dam_sids||[])].map(String));
 for(const id of [...(draft.sire_sids||[]),...(draft.dam_sids||[])])if(!priorParents.has(String(id)))add('mice','mouse_sid',id);
 if(draft.cage_sid&&String(draft.cage_sid)!==String(before?.cage_sid||'')&&draft.cage_sid!==registration?.newCage?.cage_sid){
  const cage=add('cages','cage_sid',draft.cage_sid),position=add('locations','location_id',cage.location_id);
  add('rooms','room_id',position?.room_id||cage.room_id);add('racks','rack_id',position?.rack_id||cage.rack_id);
 }
 return [...result.values()];
}

export function finalizeMouseRegistration(dataset,draft,registration,{at=new Date().toISOString(),identity=null}={}) {
 if(!/^\d{5}$/.test(draft.mouse_sid)||BigInt(draft.mouse_sid)<1n)throw new Error('New mouse SIDs must contain five digits, from 00001 through 99999.');
 if(mice(dataset).some(mouse=>mouseSidAliases(mouse).some(alias=>numericSid(alias)===BigInt(draft.mouse_sid))))throw new Error('This SID already exists. Reload before registering the mouse.');
 const identityFences=identity?.readDependencies||[];
 for(const guard of registration?.guarded||[]){const key={mice:'mouse_sid',cages:'cage_sid',locations:'location_id',rooms:'room_id',racks:'rack_id'}[guard.type];if(JSON.stringify(find(dataset,guard.type,key,guard.id))!==JSON.stringify(guard.payload))throw new Error('Cage or parent records changed. Reopen Add mouse.');}
 if(registration&&draft.cage_sid!==registration.prefill.cage_sid)throw new Error('Use the selected cage for this registration. Move the mouse afterward.');
 const next=structuredClone(registrationDataset(dataset,registration));
 if(registration?.newCage){
  const cage=next.tables.cages.find(c=>c.cage_sid===registration.newCage.cage_sid);cage.app_created_at=at;cage.app_modified_at=at;
  const check=validateRecord('cages',cage,dataset);if(check.errors.length)throw new Error(check.errors.join(' '));
  next.tables.husbandry_events.push(buildCageLocationEvent(cage,null,todayTaipei(new Date(at)),next,'Cage created with a new mouse.'));
 }
 // Bump the shared slot as an occupancy fence against a concurrent cage create/move.
 if(registration?.positionId)next.tables.locations=next.tables.locations.map(p=>p.location_id===registration.positionId?{...p,app_modified_at:new Date(Math.max(Date.parse(at),Date.parse(p.app_modified_at||'')+1||0)).toISOString()}:p);
 // A shared write fence serializes registrations that reuse the same tag.
 // Concurrent attempts cannot both pass the original record version check.
 const fenceIds=new Set(identityFences.filter(d=>d.type==='mice').map(d=>d.id));
 next.tables.mice=next.tables.mice.map(m=>fenceIds.has(String(m.mouse_sid))?{...m,app_modified_at:new Date(Math.max(Date.parse(at),Date.parse(m.app_modified_at||'')+1||0)).toISOString()}:m);
 return next;
}
