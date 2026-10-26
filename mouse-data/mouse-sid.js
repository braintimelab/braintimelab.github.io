export const MOUSE_SID_WIDTH=5;
export const MOUSE_SID_MAX=99999;
const metadataIndexes=new WeakMap();
const validCanonical=value=>typeof value==='string'&&/^\d{5}$/.test(value)&&BigInt(value)>0n;
function metadataIndex(dataset){
 if(!dataset||typeof dataset!=='object')return null;
 let index=metadataIndexes.get(dataset);if(index)return index;
 index={primary:new Map(),aliases:new Map()};
 const add=(map,key,value)=>{const values=map.get(key)||new Set();values.add(value);map.set(key,values);};
 for(const mouse of dataset.tables?.mice||[]){
  if(!validCanonical(mouse.canonical_sid))continue;
  add(index.primary,String(mouse.mouse_sid),mouse.canonical_sid);
  for(const alias of [mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])])add(index.aliases,canonicalMouseSidKey(alias),mouse.canonical_sid);
 }
 metadataIndexes.set(dataset,index);return index;
}

/** Formatting never changes an identifier stored in a record or a relation.
 * Dataset metadata translates legacy identities to the colony's reviewed SID. */
export function formatMouseSid(value,dataset=null) {
 const raw=String(value??'');
 const index=metadataIndex(dataset),primary=index?.primary.get(raw),aliases=index?.aliases.get(canonicalMouseSidKey(raw));
 if(primary?.size===1)return [...primary][0];
 if(!primary&&aliases?.size===1)return [...aliases][0];
 if(!/^\d+$/.test(raw))return raw;
 const number=BigInt(raw);
 return number>0n&&number<=BigInt(MOUSE_SID_MAX)?String(number).padStart(MOUSE_SID_WIDTH,'0'):raw;
}

/** Numeric aliases share one lookup key; decimal and named SIDs stay literal. */
export function canonicalMouseSidKey(value) {
 const raw=String(value??'');
 if(!/^\d+$/.test(raw))return raw;
 const number=BigInt(raw);
 return number>0n?String(number):raw;
}

/** Preserve exact stored keys and reject alias matches to multiple animals. */
export function resolveMouseSid(dataset,value) {
 const raw=String(value??''),rows=dataset?.tables?.mice||[];
 if(rows.some(mouse=>String(mouse.mouse_sid)===raw))return raw;
 const key=canonicalMouseSidKey(raw),matches=[...new Set(rows.filter(mouse=>[mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])].filter(value=>value!=null).some(value=>canonicalMouseSidKey(value)===key)).map(mouse=>String(mouse.mouse_sid)))];
 if(matches.length>1)throw new Error(`SID ${formatMouseSid(raw,dataset)} matches several stored mouse identities. Open the intended record and use its exact SID.`);
 return matches[0]??raw;
}
