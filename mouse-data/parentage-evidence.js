/* Display-only parentage evidence. Stored IDs, source facts and inference
 * metadata remain unchanged. Human editor confirmation is not biological proof. */
const roles=['sire','dam'];
const inferenceKinds=new Set(['source_reconciliation_inference','cage_parent_candidates']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ids=value=>Array.isArray(value)?value.map(String):String(value||'').split(/[,;\n]/).map(value=>value.trim()).filter(Boolean);
const validRoles=value=>Array.isArray(value)&&value.length>0&&value.every(role=>roles.includes(role))&&new Set(value).size===value.length;

export function parentRoleEvidence(mouse={},role){
 if(!roles.includes(role))throw new Error('Choose a sire or dam parent role.');
 const parentIds=ids(mouse[role+'_sids']),basis=object(mouse.lineage_basis)?mouse.lineage_basis:null;
 const knownInference=basis&&inferenceKinds.has(basis.kind);
 // Older cage candidates have no per-role list. A malformed list must never
 // make a known inference look like an explicit source assertion.
 const inferred=Boolean(parentIds.length&&knownInference&&(!validRoles(basis.inferred_roles)||basis.inferred_roles.includes(role)));
 const ambiguous=parentIds.length>1;
 const confidence=inferred&&basis.kind==='source_reconciliation_inference'&&['high','moderate'].includes(basis.confidence)?basis.confidence:null;
 const confirmedInEditor=inferred&&basis.confirmed_in_editor===true;
 const origin=inferred?(basis.kind==='cage_parent_candidates'?'cage parent candidates':'source reconciliation'):null;
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
 if(!row.inferred)return value;
 return row.label+(row.origin==='cage parent candidates'?' · cage candidates':'')+': '+value+(row.confirmedInEditor?' · confirmed in editor':'');
}

export function parentageEvidenceText(mouse){
 if(!parentageSummary(mouse).inferred)return '';
 const text=JSON.stringify(mouse.lineage_basis,null,2),limit=6000;
 return text.length<=limit?text:text.slice(0,limit)+'\n… More evidence is retained in Source provenance → Read full stored record.';
}
