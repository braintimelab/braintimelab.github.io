/** Read-only Family side snapshot. The caller owns authenticated RPC transport,
 * current access/source context, and presentation. Nothing here enters an
 * editable dataset, record baseline, cache, export, or write operation. */
export const FAMILY_PEDIGREE_READ_SCOPE='family_pedigree_all_dates_v1';
const MAX_ROWS=100000,MAX_PAGE_ROWS=250,MAX_ROW_ARRAY_BYTES=800000;
const MAX_SCALAR=2048,MAX_ID=200,MAX_REFERENCES=1000;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const revisionPattern=/^[a-f0-9]{32}$/;
const own=(object,key)=>Object.hasOwn(object,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const encoder=new TextEncoder();
const failure=(message,code='FAMILY_PEDIGREE_INVALID_RESPONSE')=>Object.assign(new Error(message),{code});
const require=(condition,message,code)=>{if(!condition)throw failure(message,code);};
const exactKeys=(value,required,optional=[])=>{
 require(plain(value)&&required.every(key=>own(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key)),'The Family read returned unexpected fields.');
};
function boundedString(value,max,{identifier=false}={}){
 require(typeof value==='string','A Family display value is not a string.');
 let characters=0;for(const ignored of value){if(++characters>max)throw failure('A Family display value exceeds its bound.');}
 if(identifier)require(characters>0&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value),'A Family identity cannot be verified.');
 return value;
}
const id=value=>boundedString(value,MAX_ID,{identifier:true});
function references(value){
 require(Array.isArray(value)&&value.length<=MAX_REFERENCES,'Saved Family references exceed the display contract.');
 return value.map(id); // Preserve order and duplicate saved strings exactly.
}
const equalArray=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
function compactBasis(value,payload){
 require(plain(value),'The Family parentage summary is invalid.');
 if(value.kind==='parentage_recovery_v1'){
  exactKeys(value,['kind','schema_version','projection_only','roles']);
  require(value.schema_version===1&&value.projection_only===true&&plain(value.roles),'The Family parentage summary is not a compact projection.');
  const keys=Object.keys(value.roles);
  require(keys.length>0&&keys.every(role=>['sire','dam'].includes(role)),'The Family parentage roles are invalid.');
  const result={kind:value.kind,schema_version:1,projection_only:true,roles:{}};
  for(const role of keys){
   const row=value.roles[role];exactKeys(row,['evidence_status','parent_sids'],['confidence']);
   require(['recorded','source_recorded','inferred','uncertain'].includes(row.evidence_status),'The Family evidence status is invalid.');
   const parents=references(row.parent_sids);
   require(parents.length>0&&equalArray(payload[role+'_sids'],parents),'The Family evidence does not match its visible saved parent role.');
   const entry={evidence_status:row.evidence_status,parent_sids:parents};
   if(own(row,'confidence')){
    require(row.evidence_status==='inferred'&&['high','moderate'].includes(row.confidence),'The Family inference confidence is invalid.');
    entry.confidence=row.confidence;
   }
   result.roles[role]=entry;
  }
  return result;
 }
 exactKeys(value,['kind','schema_version','inferred_roles'],['confidence']);
 require(['source_reconciliation_inference','cage_parent_candidates','litter_parent_candidates'].includes(value.kind)&&value.schema_version===1,'The Family parentage summary is not an allowed projection.');
 require(Array.isArray(value.inferred_roles)&&value.inferred_roles.length>0&&value.inferred_roles.length<=2&&new Set(value.inferred_roles).size===value.inferred_roles.length,'The Family inferred roles are invalid.');
 for(const role of value.inferred_roles)require(['sire','dam'].includes(role)&&Array.isArray(payload[role+'_sids'])&&payload[role+'_sids'].length>0,'The Family inference does not match a visible saved parent role.');
 const result={kind:value.kind,schema_version:1,inferred_roles:[...value.inferred_roles]};
 if(own(value,'confidence')){
  require(['high','moderate'].includes(value.confidence),'The Family inference confidence is invalid.');result.confidence=value.confidence;
 }
 return result;
}
const displayScalars=['physical_tag','sex','state','mouseline','genotype','date_of_birth','end_date','app_archived_at'];
const arrayFields=['legacy_sids','sire_sids','dam_sids'];
function projectedPayload(value,rawId){
 exactKeys(value,['mouse_sid'],['canonical_sid',...displayScalars,...arrayFields,'archived','lineage_basis']);
 require(id(value.mouse_sid)===rawId,'The Family payload does not match its raw record key.');
 const result={mouse_sid:rawId};
 if(own(value,'canonical_sid'))result.canonical_sid=id(value.canonical_sid);
 for(const field of displayScalars)if(own(value,field))result[field]=boundedString(value[field],MAX_SCALAR);
 for(const field of arrayFields)if(own(value,field))result[field]=references(value[field]);
 if(own(value,'archived')){require(typeof value.archived==='boolean','The Family archive display flag is invalid.');result.archived=value.archived;}
 if(own(value,'lineage_basis'))result.lineage_basis=compactBasis(value.lineage_basis,result);
 return result;
}
function envelope(value,colonyId,metadataOnly){
 exactKeys(value,['colony_id','entity_type','entity_id','version','archived'],metadataOnly?[]:['payload']);
 require(typeof value.colony_id==='string'&&value.colony_id.toLowerCase()===colonyId.toLowerCase()&&value.entity_type==='mice','The Family read returned a different colony or record type.');
 const rawId=id(value.entity_id);
 require(Number.isSafeInteger(value.version)&&value.version>0&&typeof value.archived==='boolean','The Family record version or archive flag is invalid.');
 require(metadataOnly?!own(value,'payload'):own(value,'payload'),'The Family page payload does not match its metadata mode.');
 return {id:rawId,version:value.version,archived:value.archived,...(!metadataOnly?{payload:projectedPayload(value.payload,rawId)}:{})};
}
// The SQL cursor uses COLLATE "C" on UTF-8 IDs. JS UTF-16 ordering differs for
// some non-BMP strings, so compare encoded bytes without rewriting the key.
function compareIds(a,b){
 const first=encoder.encode(a),second=encoder.encode(b),size=Math.min(first.length,second.length);
 for(let i=0;i<size;i++)if(first[i]!==second[i])return first[i]-second[i];
 return first.length-second.length;
}
function deepFreeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
const sameTuple=(a,b)=>a?.id===b.id&&a.version===b.version&&a.archived===b.archived;
const cancelled=()=>Object.assign(new Error('Family loading was cancelled.'),{name:'AbortError',code:'FAMILY_PEDIGREE_ABORTED'});
async function abortable(promise,signal){
 if(!signal)return promise;
 let listener;
 const interrupted=new Promise((resolve,reject)=>{listener=()=>reject(cancelled());signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();});
 try{return await Promise.race([promise,interrupted]);}finally{signal.removeEventListener('abort',listener);}
}

/** Exactly three complete scans: metadata -> projected records -> metadata.
 * request receives ONLY p_colony_id, p_after, p_limit, p_metadata_only. */
export async function readFamilyPedigree({colonyId,request,getContext,signal,onProgress,pageSize=250,maxRows=100000}={}){
 require(typeof colonyId==='string'&&uuid.test(colonyId),'Choose a valid colony for Family loading.','FAMILY_PEDIGREE_INVALID_ARGUMENT');
 require(typeof request==='function'&&typeof getContext==='function','Family loading requires its transport and access context.','FAMILY_PEDIGREE_INVALID_ARGUMENT');
 require(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=MAX_PAGE_ROWS&&Number.isSafeInteger(maxRows)&&maxRows>=1&&maxRows<=MAX_ROWS,'The Family read bounds are invalid.','FAMILY_PEDIGREE_INVALID_ARGUMENT');
 require(signal==null||typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function','The Family cancellation signal is invalid.','FAMILY_PEDIGREE_INVALID_ARGUMENT');
 require(onProgress==null||typeof onProgress==='function','The Family progress callback is invalid.','FAMILY_PEDIGREE_INVALID_ARGUMENT');
 const initialContext=getContext();
 require(typeof initialContext==='string'&&initialContext.length>0,'The Family access context is unavailable.','FAMILY_PEDIGREE_CONTEXT_CHANGED');
 const check=()=>{
  if(signal?.aborted)throw cancelled();
  require(getContext()===initialContext,'The account, colony, permissions or source changed during Family loading.','FAMILY_PEDIGREE_CONTEXT_CHANGED');
 };
 const progress=(phase,loaded,total)=>{check();try{onProgress?.(Object.freeze({phase,loaded,total}));}catch{/* Presentation cannot change the verified snapshot. */}check();};
 let snapshotRevision=null,totalRows=null;
 async function scan(metadataOnly,phase,initial=null){
  const rows=new Map();let after=null;progress(phase,0,totalRows);
  while(true){
   check();const params=Object.freeze({p_colony_id:colonyId,p_after:after,p_limit:pageSize,p_metadata_only:metadataOnly});let page;
   try{page=await abortable(Promise.resolve(request(params)),signal);}catch(error){check();throw error;}
   check();exactKeys(page,['schema_version','scope','snapshot_revision','total_rows','next_after','metadata_only','rows']);
   require(page.schema_version===1&&page.scope===FAMILY_PEDIGREE_READ_SCOPE&&page.metadata_only===metadataOnly,'The Family page scope or schema is invalid.');
   require(typeof page.snapshot_revision==='string'&&revisionPattern.test(page.snapshot_revision),'The Family snapshot revision is invalid.');
   require(Number.isSafeInteger(page.total_rows)&&page.total_rows>=0&&page.total_rows<=maxRows,'The Family read exceeds its verified row bound.');
   if(snapshotRevision===null){snapshotRevision=page.snapshot_revision;totalRows=page.total_rows;}
   require(page.snapshot_revision===snapshotRevision&&page.total_rows===totalRows,'Family records or access changed during loading. Read Family again.','FAMILY_PEDIGREE_CHANGED');
   require(Array.isArray(page.rows)&&page.rows.length<=pageSize&&encoder.encode(JSON.stringify(page.rows)).byteLength<=MAX_ROW_ARRAY_BYTES,'The Family record page exceeds its verified bound.');
   const next=page.next_after===null?null:id(page.next_after);let previous=after;
   for(const value of page.rows){
    const row=envelope(value,colonyId,metadataOnly);
    require(!rows.has(row.id)&&(previous===null||compareIds(row.id,previous)>0),'The Family record cursor did not advance.');
    if(initial)require(sameTuple(initial.get(row.id),row),'Family record identities, versions or archive flags changed during loading.','FAMILY_PEDIGREE_CHANGED');
    rows.set(row.id,row);previous=row.id;
   }
   require(rows.size<=totalRows&&rows.size<=maxRows,'The Family page contains an unexpected record count.');
   if(next!==null)require(page.rows.length>0&&next===previous&&rows.size<totalRows,'The Family continuation cursor is invalid.');
   progress(phase,rows.size,totalRows);
   if(next===null){require(rows.size===totalRows,'The Family read is incomplete. No partial pedigree was returned.','FAMILY_PEDIGREE_CHANGED');break;}
   after=next;
  }
  check();return rows;
 }
 const metadata=await scan(true,'metadata');
 const payloads=await scan(false,'records',metadata);
 const verified=await scan(true,'verify',metadata);
 require(metadata.size===payloads.size&&metadata.size===verified.size,'The Family snapshot is incomplete.','FAMILY_PEDIGREE_CHANGED');check();
 return deepFreeze({scope:FAMILY_PEDIGREE_READ_SCOPE,colonyId,snapshotRevision,totalRows,readOnly:true,
  records:[...payloads.values()].map(row=>row.payload),versions:[...metadata.values()].map(({id,version,archived})=>({entityId:id,version,archived}))});
}
