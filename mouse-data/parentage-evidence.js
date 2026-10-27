/* Display-only parentage evidence. Stored IDs, source facts and inference
 * metadata remain unchanged. Human editor confirmation is not biological proof. */
const roles=['sire','dam'];
const inferenceKinds=new Set(['source_reconciliation_inference','cage_parent_candidates','litter_parent_candidates']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ids=value=>Array.isArray(value)?value.map(String):String(value||'').split(/[,;\n]/).map(value=>value.trim()).filter(Boolean);
const validRoles=value=>Array.isArray(value)&&value.length>0&&value.every(role=>roles.includes(role))&&new Set(value).size===value.length;
const sameIds=(first,second)=>Array.isArray(first)&&first.length===second.length&&first.every((id,index)=>typeof id==='string'&&id===second[index]);

function recoveredRoleEvidence(mouse,role,depth){
 const parentIds=ids(mouse[role+'_sids']),basis=mouse.lineage_basis,entry=object(basis.roles)?basis.roles[role]:null;
 if(!parentIds.length)return legacyRoleEvidence({...mouse,lineage_basis:null},role);
 if(entry===undefined||entry===null){
  const original=basis.original_parentage?.[role];
  if(object(original)&&original.present===true&&sameIds(original.value,parentIds)){
   const prior=basis.prior_lineage_basis;
   if(object(prior)&&prior.present===true&&object(prior.value)&&depth<8)return roleEvidence({...mouse,lineage_basis:prior.value},role,depth+1);
   if(object(prior)&&prior.present===false)return legacyRoleEvidence({...mouse,lineage_basis:null},role);
  }
 }
 const projected=basis.projection_only===true;
 const valid=basis.schema_version===1&&object(entry)&&sameIds(entry.parent_sids,parentIds)&&(projected?['source_recorded','inferred','recorded'].includes(entry.evidence_status):entry.evidence_status==='source_recorded'?entry.rule==='direct_parent_observation_v1'&&entry.confidence===undefined:entry.evidence_status==='inferred'&&entry.rule==='linked_litter_parent_v1'&&entry.confidence==='moderate');
 if(valid&&projected&&entry.evidence_status==='recorded')return legacyRoleEvidence({...mouse,lineage_basis:null},role);
 const sourceRecorded=valid&&entry.evidence_status==='source_recorded',inferred=!sourceRecorded,ambiguous=parentIds.length>1;
 const confidence=valid&&inferred&&['high','moderate'].includes(entry.confidence)?entry.confidence:null;
 const origin=sourceRecorded?'stored source parent fields':valid&&entry.rule==='linked_litter_parent_v1'?'linked litter records':'lineage recovery';
 let label=sourceRecorded?(ambiguous?'Source-recorded alternatives':'Source-recorded parent'):'Inferred'+(confidence?' · '+confidence+' confidence':'');
 if(!valid)label='Inferred · evidence needs review';
 const detail=!valid?'The stored recovery evidence no longer matches this parent role. Review its source before relying on it.':sourceRecorded?'Recovered from an explicit stored source parent field. Biological parentage is not independently confirmed.':'Inferred from '+origin+'.'+(confidence?' '+confidence[0].toUpperCase()+confidence.slice(1)+' confidence.':'')+' Biological parentage remains inferred.'+(ambiguous?' Candidate parents remain unresolved.':'');
 return {role,ids:parentIds,inferred,ambiguous,uncertain:inferred||ambiguous,confidence,confirmedInEditor:false,origin,label,detail,
  recovered:valid,sourceRecorded,evidenceStatus:valid?entry.evidence_status:'unverified',
  edgeLabel:role+(inferred?' inferred':'')+(ambiguous?' ?':''),title:(role==='sire'?'Sire':'Dam')+': '+label+' · '+detail};
}

// Bounded display status only. Never disclose evidence references, source cells,
// saved original parentage or a prior basis through restricted exports/caches.
export function projectParentageEvidence(source,visible){
 const basis=source?.lineage_basis;
 if(!object(basis))return null;
 if(basis.kind==='parentage_recovery_v1'){
  const result={kind:basis.kind,schema_version:1,projection_only:true,roles:{}};
  for(const role of roles){
   const parentIds=visible?.[role+'_sids'];
   if(!Array.isArray(parentIds)||!parentIds.length||parentIds.some(id=>typeof id!=='string'||!id.trim()))continue;
   const row=parentRoleEvidence(source,role),aligned=sameIds(row.ids,parentIds);
   const status=!aligned||row.evidenceStatus==='unverified'?'uncertain':row.sourceRecorded?'source_recorded':row.inferred?'inferred':'recorded';
   result.roles[role]={evidence_status:status,parent_sids:[...parentIds]};
   if(status==='inferred'&&['high','moderate'].includes(row.confidence))result.roles[role].confidence=row.confidence;
  }
  return Object.keys(result.roles).length?result:null;
 }
 if(!inferenceKinds.has(basis.kind))return null;
 const configured=basis.inferred_roles,valid=validRoles(configured);
 const inferred=roles.filter(role=>Array.isArray(visible?.[role+'_sids'])&&visible[role+'_sids'].some(id=>typeof id==='string'&&id.trim())&&(!valid||configured.includes(role)));
 if(!inferred.length)return null;
 const summary={kind:basis.kind,schema_version:1,inferred_roles:inferred};
 if(['high','moderate'].includes(basis.confidence))summary.confidence=basis.confidence;
 return summary;
}

export function parentRoleEvidence(mouse={},role){
 if(!roles.includes(role))throw new Error('Choose a sire or dam parent role.');
 return roleEvidence(mouse,role,0);
}
function roleEvidence(mouse,role,depth){
 if(object(mouse.lineage_basis)&&mouse.lineage_basis.kind==='parentage_recovery_v1')return recoveredRoleEvidence(mouse,role,depth);
 return legacyRoleEvidence(mouse,role);
}
function legacyRoleEvidence(mouse,role){
 const parentIds=ids(mouse[role+'_sids']),basis=object(mouse.lineage_basis)?mouse.lineage_basis:null;
 const knownInference=basis&&inferenceKinds.has(basis.kind);
 // Older cage candidates have no per-role list. A malformed list must never
 // make a known inference look like an explicit source assertion.
 const inferred=Boolean(parentIds.length&&knownInference&&(!validRoles(basis.inferred_roles)||basis.inferred_roles.includes(role)));
 const ambiguous=parentIds.length>1;
 const confidence=inferred&&basis.kind==='source_reconciliation_inference'&&['high','moderate'].includes(basis.confidence)?basis.confidence:null;
 const confirmedInEditor=inferred&&basis.confirmed_in_editor===true;
 const origin=inferred?(basis.kind==='cage_parent_candidates'?'cage parent candidates':basis.kind==='litter_parent_candidates'?'litter and mating parent candidates':'source reconciliation'):null;
 let label=parentIds.length?(ambiguous?'Recorded alternatives':'Single recorded parent'):'Not recorded';
 if(inferred)label=(ambiguous?'Inferred alternatives':'Inferred')+(confidence?' · '+confidence+' confidence':'');
 const detail=inferred?'Inferred from '+origin+'.'+(confidence?' '+confidence[0].toUpperCase()+confidence.slice(1)+' confidence.':'')+(confirmedInEditor?' Confirmed in editor; biological parentage remains inferred.':'')+(ambiguous?' Candidate parents remain unresolved.':''):ambiguous?'Candidate parents · Unresolved':'';
 return {role,ids:parentIds,inferred,ambiguous,uncertain:inferred||ambiguous,confidence,confirmedInEditor,origin,label,detail,
  edgeLabel:role+(inferred?' inferred':'')+(ambiguous?' ?':''),
  title:(role==='sire'?'Sire':'Dam')+': '+label+(detail?' · '+detail:'')};
}

export function parentageSummary(mouse={}){
 const evidence=roles.map(role=>parentRoleEvidence(mouse,role));
 const inferred=evidence.some(row=>row.inferred),ambiguous=evidence.some(row=>row.ambiguous),present=evidence.some(row=>row.ids.length);
 return {inferred,ambiguous,present,state:inferred?(ambiguous?'Inferred alternatives':'Inferred'):ambiguous?'Ambiguous':present?'Recorded':'Not recorded'};
}

export function parentageLinkLabel(child,parentId){
 return roles.map(role=>parentRoleEvidence(child,role)).filter(row=>row.ids.includes(String(parentId))).map(row=>row.title).join('; ');
}

export function parentageLinkInferred(child,parentId){
 return roles.some(role=>{const row=parentRoleEvidence(child,role);return row.inferred&&row.ids.includes(String(parentId));});
}

export function sharedParentageInferred(first,second){
 const firstIds=new Set(roles.flatMap(role=>parentRoleEvidence(first,role).ids));
 return roles.flatMap(role=>parentRoleEvidence(second,role).ids).some(id=>firstIds.has(id)&&(parentageLinkInferred(first,id)||parentageLinkInferred(second,id)));
}

export function parentageCardValue(mouse,role,formatSid=value=>value){
 const row=parentRoleEvidence(mouse,role);
 if(!row.ids.length)return 'Not recorded';
 const value=row.ids.map(formatSid).join(', ')+(row.ambiguous?' (alternatives)':'');
 if(!row.inferred)return row.sourceRecorded?row.label+': '+value:value;
 return row.label+(row.origin==='cage parent candidates'?' · cage candidates':'')+': '+value+(row.confirmedInEditor?' · confirmed in editor':'');
}

export function parentageEvidenceText(mouse){
 if(!parentageSummary(mouse).inferred&&mouse?.lineage_basis?.kind!=='parentage_recovery_v1')return '';
 const text=JSON.stringify(mouse.lineage_basis,null,2),limit=6000;
 return text.length<=limit?text:text.slice(0,limit)+'\n… More evidence is retained in Source provenance → Read full stored record.';
}
