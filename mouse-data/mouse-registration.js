import { parseCompactStrainNotation } from './mouse-summary.js?v=91';
import { cageSheetAnimals, ageWeeks, todayTaipei } from './cage-observations.js?v=91';
import { getBreedingOptions } from './breeding-options.js?v=91';
import { cageManager, buildCageLocationEvent, validateRecord } from './model.js?v=91';

const active=r=>r&&!r.archived&&!r.app_archived_at&&!r.history_read_only&&!r.source_historical;
const mice=data=>data?.tables?.mice||[];
const find=(data,type,key,id)=>(data?.tables?.[type]||[]).find(r=>String(r[key])===String(id));
const names={P:'PER2::LUC',E:'Bmal1-ELuc',B:'Bmal1-flox',F:'FoxJ1-Cre',V:'Vip-Cre',AD:'APP/PS1',A:'Avp-Cre',Vg:'Vgat-flox',32:'Ai32',96:'Ai96',Gt:'GAD67-tTA2',WT:'WT'};

/** Numeric candidates are provisional. The shared save's expected_version=0
 * is the final uniqueness check; never regenerate after an unknown save result. */
export function newNumericMouseSid(dataset,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]) {
 const used=new Set(mice(dataset).map(m=>/^\d+$/.test(String(m.mouse_sid))?String(Number(m.mouse_sid)):String(m.mouse_sid)));
 for(let i=0;i<1000;i++){const id=String(100000+(random()>>>0)%900000);if(!used.has(id))return id;}
 throw new Error('Could not allocate a mouse SID. Refresh and try again.');
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
 if(!/^\d{5,6}$/.test(draft.mouse_sid))throw new Error('New mouse SIDs must contain 5 or 6 digits.');
 if(mice(dataset).some(m=>/^\d+$/.test(m.mouse_sid)&&Number(m.mouse_sid)===Number(draft.mouse_sid)))throw new Error('This SID already exists. Reload before registering the mouse.');
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
