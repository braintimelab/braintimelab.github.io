/* Current-month forecasts from physical cage cards. No source label creates a
 * Mouse identity, historical occupancy interval, or SPF arrival date. */
import {projectAnimalSheet} from './animal-sheet-export.js?v=99';
import {cageCardObservation,cageSheetAnimals,todayTaipei} from './cage-observations.js?v=99';
import {resolveCageStart,validCageStartDate} from './cage-start.js?v=99';
import {classifyAnimalSheetBreedingBlock,sourceChangeBlocks} from './breeding-summary.js?v=99';
import {mouseLineAssignments} from './mouse-summary.js?v=99';

const defs={clean_room:'cage',rat_locobox:'cage',spf_room:'mouse'};
const list=v=>Array.isArray(v)?v.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)):[];
const id=v=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';
const active=r=>r&&!r.app_archived_at&&r.archived!==true;
const historical=r=>r?.history_read_only===true||r?.source_historical===true||/^historical_(?:snapshot|assignment)_projection$/.test(r?.record_origin||'');
const currentPosition=r=>active(r)&&!historical(r)&&r.source_current!==false;
const tag=v=>id(v).replace(/[‘’′]/g,"'").replace(/\s+/g,'');
const iso=v=>validCageStartDate(v);
const index=(rows,key)=>{const map=new Map();for(const row of list(rows)){const keyValue=id(row[key]);if(!keyValue)continue;const found=map.get(keyValue)||[];found.push(row);map.set(keyValue,found);}return map;};
const unique=(map,key)=>{const found=map.get(id(key));return found?.length===1&&active(found[0])&&!historical(found[0])?found[0]:null;};
const bounds=month=>{if(typeof month!=='string'||!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month))return null;const last=new Date(month+'-01T00:00:00Z');last.setUTCMonth(last.getUTCMonth()+1,0);return {start:month+'-01',end:last.toISOString().slice(0,10),days:last.getUTCDate()};};
const emptyObservation=()=>({schemaVersion:1,animals:[]});

function classify(observation){
 const evidence=[],unresolved=[];let uncertain=false;
 for(const animal of observation.animals||[]){
  const value=id(animal.tag),note=id(animal.note),result=classifyAnimalSheetBreedingBlock({source_cell:'A1',source_block_text:'A2: '+value.replace(/[\r\n]/g,' ')+'\nA2 comment: '+note.replace(/[\r\n]/g,' ')});
  evidence.push(...result.evidence.map(row=>({...row,sourceCell:animal.sourceCell??null,dateOfBirth:animal.dateOfBirth??null,requiresReview:animal.requiresReview===true})));
  unresolved.push(...result.unresolved);
  // A strain token is not one mouse. Retain that uncertainty for per-mouse
  // billing rather than turning the nonempty row into either one mouse or zero.
  if(!result.evidence.length&&(result.unresolved.length||animal.sex||animal.dateOfBirth||Object.keys(mouseLineAssignments({physical_tag:value})).length))uncertain=true;
 }
 return {evidence,unresolved,uncertain};
}

/** Per-group quantities retain their exact configured cage/mouse and day/month
 * units. Unknown groups return null with a compact reason and known partials. */
export function currentCageStartQuantities(dataset,month,options,{asOf=todayTaipei()}={}){
 const calendar=bounds(month);if(!calendar||!iso(asOf))throw new TypeError('Choose a valid fee month and observation date.');
 const configured=list(options?.groups),groups=Object.fromEntries(Object.entries(defs).map(([key,unit])=>{const setting=configured.find(g=>g.key===key),period=setting?.rate_period==='month'?'month':'day';return [key,{quantity:0,quantity_unit:unit+'_'+period,basis:'cage_start_projection',reason:'Current physical cage forecast',occupied_cages:0,mouse_count:0,partial_quantity:0,unknown_count:0,estimated_starts:0,source_cages:0,registered_cages:0}];}));
 const result={basis:'cage_start_projection',groups,excluded_mice:0,unmapped_mice:0,unmapped_cages:0};
 const problems=Object.fromEntries(Object.keys(defs).map(k=>[k,new Set()]));
 const fail=(keys,reason)=>{for(const key of keys){if(!groups[key])continue;problems[key].add(reason);groups[key].unknown_count++;}};
 const allKeys=Object.keys(groups),settings={};
 if(month!==asOf.slice(0,7)||dataset?.history_projection?.read_only===true){for(const g of Object.values(groups))Object.assign(g,{quantity:null,basis:'historical_unavailable',reason:'Complete historical occupancy unavailable',unknown_count:1});result.basis='historical_unavailable';return result;}
 for(const key of allKeys){const matches=configured.filter(g=>g.key===key),setting=matches[0];settings[key]=setting;if(matches.length!==1||setting.unit!==defs[key]||!['day','month'].includes(setting.rate_period)||!Array.isArray(setting.room_ids)||!setting.room_ids.length||setting.room_ids.some(x=>!id(x))||new Set(setting.room_ids).size!==setting.room_ids.length||!Array.isArray(setting.rack_ids)||setting.rack_ids.some(x=>!id(x))||new Set(setting.rack_ids).size!==setting.rack_ids.length)fail([key],'Room or billing-unit mapping needs review');}
 const tables=dataset?.tables||{},indexes={rooms:index(tables.rooms,'room_id'),racks:index(tables.racks,'rack_id'),locations:index(tables.locations,'location_id'),cages:index(tables.cages,'cage_sid')};
 const excluded=new Set((options?.excluded_room_ids||[]).map(id));
 for(const key of allKeys)for(const roomId of settings[key]?.room_ids||[])if(excluded.has(id(roomId))||!unique(indexes.rooms,roomId))fail([key],'Room mapping needs review');
 const mice=list(tables.mice).filter(m=>active(m)&&!historical(m)&&m.state==='Stock'),mouseIds=index(mice,'mouse_sid'),stockCages=new Set(mice.map(m=>id(m.cage_sid)));
 const cages=list(tables.cages).filter(c=>active(c)&&!historical(c)&&!c._derived&&(['active','occupied'].includes(id(c.state).toLowerCase())||stockCages.has(id(c.cage_sid))));
 const positions=list(tables.locations).filter(currentPosition),view={...dataset,tables:{...tables,mice,cages,locations:positions}};
 const changes=new Map();for(const event of list(tables.husbandry_events)){const change=event.animal_sheet_change;if(active(event)&&event.event_type==='animal_sheet_source_change'&&change?.entity_type==='locations'){const key=id(change.entity_id),found=changes.get(key)||[];found.push(event);changes.set(key,found);}}
 const byRoom=roomIds=>allKeys.filter(key=>(settings[key]?.room_ids||[]).some(room=>roomIds.includes(id(room))));
 function assignment(item){
  const cage=item.cage,position=item.position,locationId=id(cage?.location_id||position?.location_id),rackIds=[...new Set([id(cage?.rack_id),id(position?.rack_id)].filter(Boolean))],rack=rackIds.length===1?unique(indexes.racks,rackIds[0]):null;
  const roomIds=[...new Set([id(cage?.room_id),id(position?.room_id),id(rack?.room_id)].filter(Boolean))],affected=byRoom(roomIds);
  if(roomIds.length===1&&excluded.has(roomIds[0])){result.excluded_mice+=item.mice.length;return null;}
  const bad=roomIds.length!==1||!unique(indexes.rooms,roomIds[0])||rackIds.length>1||rackIds.length===1&&!rack||locationId&&(!position||!currentPosition(position)||!unique(indexes.locations,locationId))||cage&&!unique(indexes.cages,cage.cage_sid);
  if(bad){fail(affected,'Current housing needs review');result.unmapped_mice+=item.mice.length;if(item.cage)result.unmapped_cages++;return null;}
  const matched=affected.filter(key=>!(settings[key]?.rack_ids||[]).length||settings[key].rack_ids.includes(rackIds[0]));
  if(matched.length!==1){if(affected.length)fail(affected,'Room or rack mapping needs review');result.unmapped_mice+=item.mice.length;if(item.cage)result.unmapped_cages++;return null;}
  return {key:matched[0],roomId:roomIds[0],rackId:rackIds[0]||'',locationId,position};
 }
 const projection=projectAnimalSheet(view,{entityTypes:[],capturedAt:asOf+'T12:00:00+08:00'}),slots=new Map(),seenMice=new Set();
 for(const item of projection.rows){
  if(item.cage?._derived){const rooms=[id(item.roomId)].filter(Boolean),affected=byRoom(rooms);fail(affected,'Current cage record unavailable');result.unmapped_mice+=item.mice.length;result.unmapped_cages++;continue;}
  const place=assignment(item);if(!place)continue;
  const {key,position}=place,setting=settings[key];if(!setting)continue;
  const grid=position&&place.rackId&&Number.isInteger(position.row)&&position.row>=0&&Number.isInteger(position.column)&&position.column>=0;
  const physical=position?(grid?JSON.stringify([place.roomId,place.rackId,'grid',position.row,position.column]):JSON.stringify([place.roomId,'position',place.locationId])):JSON.stringify([place.roomId,'cage',id(item.cage?.cage_sid)]);
  const slot=slots.get(physical)||{key,items:[],residents:new Map(),sources:[],cages:new Set()};if(slot.key!==key){fail([slot.key,key],'Physical cage has conflicting billing groups');continue;}slot.items.push(item);
  if(item.cage)slot.cages.add(id(item.cage.cage_sid));
  for(const mouse of item.mice){const sid=id(mouse.mouse_sid);if(!sid||mouseIds.get(sid)?.length!==1||seenMice.has(sid)){fail([key],'Current mouse assignment needs review');continue;}seenMice.add(sid);slot.residents.set(sid,mouse);}
  if(position){
   const card=cageCardObservation(view,item),ownCard=item.cage?.cage_sheet_card?.schemaVersion===1,linked=item.cage&&id(item.cage.cage_sheet_source_location_id)===id(card.source_location_id),rows=cageSheetAnimals(view,item);
   // A saved individual transfer removes that animal from its former displayed
   // card while retaining the immutable imported observation underneath.
   const observation=item.cage&&!ownCard&&!linked?emptyObservation():{...card.observation,animals:card.observation.animals.filter(animal=>rows.some(row=>row.sourceCell===animal.sourceCell&&tag(row.sourceTag||row.tag)===tag(animal.tag)))};
   const sourcePosition=unique(indexes.locations,card.source_location_id)||position,classified=classify(observation),hasAnimals=classified.evidence.length>0||classified.uncertain;
   if(hasAnimals&&!ownCard&&(sourcePosition.record_origin!=='current_google_sheet_map'||sourcePosition.source_current!==true||!iso(sourcePosition.source_snapshot_date)||sourcePosition.source_snapshot_date>asOf)){fail([key],'Current Animal Sheet date unavailable');}
   if(!ownCard&&(sourcePosition.source_import_conflict||sourcePosition.source_label_conflict&&!(key!=='rat_locobox'&&grid)||sourceChangeBlocks(sourcePosition,changes.get(id(sourcePosition.location_id))||[],asOf)))fail([key],'Current Animal Sheet position needs review');
   slot.sources.push({item,observation,classified,rows});
  }
  slots.set(physical,slot);
 }
 const sourceMice=new Map(),sourceTags=new Map();for(const [physical,slot]of slots)for(const [sid,mouse]of slot.residents){sourceMice.set('sid:'+sid,physical);const literal=tag(mouse.physical_tag);if(literal){const found=sourceTags.get(literal)||[];found.push({physical,dateOfBirth:mouse.date_of_birth||null});sourceTags.set(literal,found);}}
 for(const [physical,slot]of slots){
  const g=groups[slot.key],setting=settings[slot.key],classified=slot.sources.flatMap(s=>s.classified.evidence),occupied=slot.residents.size>0||classified.length>0;
  if(slot.cages.size>1)fail([slot.key],'Multiple cages share one physical slot');
  if(!occupied){if(slot.key==='spf_room'&&slot.sources.some(s=>s.classified.uncertain))fail([slot.key],'SPF mouse count needs review');continue;}
  g.occupied_cages++;if(slot.residents.size)g.registered_cages++;else g.source_cages++;
  if(setting.unit==='cage'){
   if(setting.rate_period==='month'){g.partial_quantity++;continue;}
   const dates=new Set();let estimated=false;for(const item of slot.items){const contains=item.mice.length||slot.sources.some(s=>s.item===item&&s.classified.evidence.length);if(!contains)continue;const start=resolveCageStart(view,item,{asOf});if(!iso(start.date)||start.date>asOf)fail([slot.key],'Cage start date unavailable');else{dates.add(start.date);estimated||=start.estimated===true;}}
   if(dates.size!==1){if(dates.size>1)fail([slot.key],'Physical cage start dates disagree');continue;}
   const start=[...dates][0],first=start>calendar.start?start:calendar.start;g.partial_quantity+=(Date.parse(calendar.end+'T00:00:00Z')-Date.parse(first+'T00:00:00Z'))/86400000+1;if(estimated)g.estimated_starts++;continue;
  }
  const counted=new Set([...slot.residents.keys()].map(sid=>'sid:'+sid));
  for(const source of slot.sources){
   if(source.classified.uncertain||source.classified.unresolved.length)fail([slot.key],'SPF mouse count needs review');
   const localTags=new Set();
   for(const evidence of source.classified.evidence){
    const identity=JSON.stringify([tag(evidence.tag),evidence.dateOfBirth]);if(localTags.has(identity)||evidence.requiresReview){fail([slot.key],'SPF mouse count needs review');continue;}localTags.add(identity);
    const previousTags=sourceTags.get(tag(evidence.tag))||[];if(previousTags.some(previous=>previous.physical!==physical&&(!previous.dateOfBirth||!evidence.dateOfBirth||previous.dateOfBirth===evidence.dateOfBirth)||previous.physical===physical&&previous.dateOfBirth!==evidence.dateOfBirth&&(!previous.dateOfBirth||!evidence.dateOfBirth)))fail([slot.key],'SPF mouse appears in multiple cages');previousTags.push({physical,dateOfBirth:evidence.dateOfBirth});sourceTags.set(tag(evidence.tag),previousTags);
    const rows=source.rows.filter(row=>row.sourceCell===evidence.sourceCell&&tag(row.sourceTag||row.tag)===tag(evidence.tag)),row=rows.length===1?rows[0]:null;
    if(row&&['ambiguous','conflict','duplicate_position','invalid_mouse'].includes(row.matchStatus)){fail([slot.key],'SPF mouse identity needs review');continue;}
    const key=row?.mouseSid?'sid:'+id(row.mouseSid):'tag:'+identity,previous=sourceMice.get(key);if(previous&&previous!==physical)fail([slot.key],'SPF mouse appears in multiple cages');sourceMice.set(key,physical);counted.add(key);
   }
  }
  g.mouse_count+=counted.size;g.partial_quantity+=counted.size*(setting.rate_period==='day'?calendar.days:1);
 }
 for(const key of allKeys){const g=groups[key];g.quantity=problems[key].size?null:g.partial_quantity;g.reason=problems[key].size?[...problems[key]][0]:defs[key]==='cage'?'Current cages projected from '+(g.estimated_starts?'recorded or estimated':'recorded')+' starts to month end':'Current SPF mice projected to month end';}
 return result;
}
