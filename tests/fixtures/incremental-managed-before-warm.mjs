async function incrementalManaged(type,c,check,reuse,restricted=false,read=request,onVerified=()=>{},scope=null,eventTypes=[]){
  const index=await managedVersionIndex(type,c,check,read,scope,eventTypes),rows=new Map(),pending=[],reused=new Set();
  for(const row of index.values()){const cached=reusableRecord(reuse,row,c);if(cached&&(!restricted||ordinaryManagedRecord(cached))){rows.set(row.entity_id,cached);reused.add(row.entity_id);}else pending.push(row);}
  onVerified(rows.size,index.size);
  // A newly opened feature may contain many uncached rows. Read bounded RPC
  // pages instead of issuing hundreds of twenty-ID payload requests.
  if(scope&&(pending.length>100||pending.length&&!feeVisibility?.source_archive_allowed)){
    const loadedRows=[],seen=new Set();let cursor=null,limit=1000;
    while(true){
      const loaded=await readCloudPage(size=>read('rpc/get_managed_record_page',{method:'POST',cloudSource:'cloud1',body:{p_colony_id:c.colonyId,p_entity_type:type,p_scope:scope,p_event_types:eventTypes,p_after:cursor,p_limit:size,p_metadata_only:false}}),limit,check);
      const page=loaded.page;limit=loaded.limit;if(!Array.isArray(page)||page.length>limit)throw new Error('Cloud records were not returned as a valid page.');
      for(const value of page){const row=checkedCloudRecord(value,type,c),expected=index.get(row.entity_id);if(!expected||row.version!==expected.version||row.archived!==expected.archived||seen.has(row.entity_id))throw new Error('Cloud records changed during loading. Retry this view.');seen.add(row.entity_id);loadedRows.push(row);}
      onVerified(loadedRows.length,index.size);if(page.length<limit)break;cursor=page.at(-1).entity_id;
    }
    const final=await managedVersionIndex(type,c,check,read,scope,eventTypes);
    if(loadedRows.length!==index.size||final.size!==index.size||[...index].some(([id,row])=>final.get(id)?.version!==row.version||final.get(id)?.archived!==row.archived))throw new Error('Cloud records changed during loading. Retry this view.');
    const result=loadedRows.filter(row=>!restricted||ordinaryManagedRecord(row));result.reused=0;return result;
  }
  const batches=[];
  for(let offset=0;offset<pending.length;){
    const batch=[pending[offset++]];
    // Simple literal keys can share a bounded IN request. Arbitrary IDs retain
    // equality parameters so punctuation/Unicode never changes filter syntax.
    if(/^[A-Za-z0-9_:-]{1,100}$/.test(batch[0].entity_id))while(offset<pending.length&&batch.length<20&&/^[A-Za-z0-9_:-]{1,100}$/.test(pending[offset].entity_id))batch.push(pending[offset++]);
    batches.push(batch);
  }
  let next=0,failure=null;
  const active=()=>{check();if(failure)throw failure;};
  async function worker(){try{while(true){active();const batch=batches[next++];if(!batch)return;
    let offset=0,limit=batch.length;
    while(offset<batch.length){
      const wanted=batch.slice(offset,offset+limit),expected=new Map(wanted.map(row=>[row.entity_id,row]));
      const query=new URLSearchParams({select:'colony_id,entity_type,entity_id,payload,version,archived',colony_id:`eq.${c.colonyId}`,entity_type:`eq.${type}`,entity_id:wanted.length===1?`eq.${wanted[0].entity_id}`:`in.(${wanted.map(row=>row.entity_id).join(',')})`,limit:String(wanted.length)});
      const loaded=await readCloudPage(size=>{const selected=batch.slice(offset,offset+size);query.set('entity_id',selected.length===1?`eq.${selected[0].entity_id}`:`in.(${selected.map(row=>row.entity_id).join(',')})`);query.set('limit',String(selected.length));return read(`entity_records?${query}`);},wanted.length,active);
      const page=loaded.page,selected=batch.slice(offset,offset+loaded.limit),selectedIds=new Set(selected.map(row=>row.entity_id));
      if(!Array.isArray(page)||page.length!==selected.length)throw new Error('A changed cloud record is missing. Pull again.');
      for(const value of page){const row=checkedCloudRecord(value,type,c),prior=expected.get(row.entity_id);if(!selectedIds.delete(row.entity_id)||!prior||row.version!==prior.version||row.archived!==prior.archived)throw new Error('A cloud record changed during loading. Pull again.');rows.set(row.entity_id,row);}
      active();onVerified(rows.size,index.size);
      offset+=selected.length;limit=loaded.limit;
    }
  }}catch(error){failure??=error;throw error;}}
  await Promise.all(Array.from({length:Math.min(3,batches.length)},()=>worker()));check();
  // If every live tuple exactly matches the verified atomic cache, retain that
  // existing snapshot. There are no incoming payloads to merge or recheck.
  // A changed payload or missing cached ID still requires the final scan.
  let cachedCount=0;for(const row of reuse.records.values())if(row.entity_type===type)cachedCount++;
  if(pending.length||index.size!==cachedCount){
    const final=await managedVersionIndex(type,c,check,read,scope,eventTypes);
    if(final.size!==index.size||[...index].some(([id,row])=>final.get(id)?.version!==row.version||final.get(id)?.archived!==row.archived))throw new Error('Cloud records changed during loading. Pull again.');
  }
  const result=[...index.keys()].map(id=>rows.get(id)).filter(row=>!restricted||ordinaryManagedRecord(row));result.reused=result.filter(row=>reused.has(row.entity_id)).length;return result;
}
