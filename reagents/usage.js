import {itemName,itemClassification,esc,text} from './model.js?v=5';

export const USAGE_GROUPS=Object.freeze([
  Object.freeze({id:'frequent',label:'Frequent use'}),
  Object.freeze({id:'chemicals',label:'Chemicals'}),
  Object.freeze({id:'equipment',label:'Equipment'}),
  Object.freeze({id:'other',label:'Other'}),
]);
const groupIDs=new Set(USAGE_GROUPS.map(group=>group.id));
const normalize=value=>text(value).normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
const identity=value=>normalize(value).replace(/[\s‐‑–—_-]+/g,'');
const frequentNames=new Set(['chloroform','trichloromethane','dichloromethane','dcm','methylenechloride']);
const frequentCAS=new Set(['67-66-3','75-09-2']);
const isEligible=row=>!!row&&['item','equipment'].includes(row.kind)&&!row.archived&&typeof row.id==='string'&&!!row.id.trim();
const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const compare=(a,b)=>collator.compare(a,b)||(a<b?-1:a>b?1:0);
const sortKeys=row=>{const p=row.payload||{};return [itemName(row),p.brand,p.catalog_number,p.barcode,p.unit,p.location,row.id].map(text);};
const compareItems=(a,b)=>{const left=sortKeys(a),right=sortKeys(b);for(let i=0;i<left.length;i++){const result=compare(left[i],right[i]);if(result)return result;}return 0;};

// A mixture is not a shortcut for a bottle of either pure solvent.
function isFrequent(row){
  if(itemClassification(row)==='Equipment')return false;
  const p=row.payload||{},name=itemName(row);
  if(p.is_mixture===true||p.mixture===true||/\b(?:mixture|mix|blend|solution|dissolved|with|in)\b|混合|溶液/i.test(name))return false;
  if(frequentNames.has(identity(name)))return true;
  // The current sheet appends Chinese names and regulated concentration
  // thresholds. Keep those exact solvent labels in Frequent use too.
  const suffix=name.match(/^(?:chloroform|trichloromethane|dichloromethane|dcm|methylene\s+chloride)\b(.*)$/i)?.[1]||'';
  if(/[\u3400-\u9fff]/.test(suffix)&&!/[A-Za-z+/:&]/.test(suffix))return true;
  return [p.cas_number,p.cas,p.cas_no].some(value=>typeof value==='string'&&frequentCAS.has(value.trim().replace(/^CAS\s*(?:No\.?\s*|#\s*)?:?\s*/i,'')));
}
export function usageGroup(row){
  if(!isEligible(row))return '';
  if(isFrequent(row))return 'frequent';
  const classification=itemClassification(row);
  return classification==='Equipment'?'equipment':classification==='Chemicals'?'chemicals':'other';
}
function eligibleItems(rows){
  const counts=new Map();for(const row of rows||[])if(isEligible(row))counts.set(row.id,(counts.get(row.id)||0)+1);
  // Duplicate IDs cannot be distinguished safely by an HTML option value.
  return (rows||[]).filter(row=>isEligible(row)&&counts.get(row.id)===1);
}
export function usageItemLabel(row){
  const p=row?.payload||{},details=[p.brand,p.catalog_number||p.catalogue_number,p.barcode||p.container_id,p.lot_number,p.unit,p.location].map(value=>text(value).trim()).filter(Boolean);
  return [itemName(row),...new Set(details)].join(' · ');
}
export function buildUsageGroups(rows,{query=''}={}){
  const groups=USAGE_GROUPS.map(group=>({...group,rows:[]})),byID=new Map(groups.map(group=>[group.id,group])),words=normalize(query).split(' ').filter(Boolean);
  for(const row of eligibleItems(rows)){
    const p=row.payload||{},haystack=normalize([usageItemLabel(row),row.id,p.cas_number,p.cas,p.cas_no,p.category,itemClassification(row)].join(' '));
    if(words.every(word=>haystack.includes(word)))byID.get(usageGroup(row)).rows.push(row);
  }
  for(const group of groups)group.rows.sort(compareItems);
  return groups;
}
export function resolveUsageSelection(rows,{group='frequent',selectedId='',query=''}={}){
  if(!groupIDs.has(group)||!selectedId)return null;
  return buildUsageGroups(rows,{query}).find(candidate=>candidate.id===group).rows.find(row=>row.id===selectedId)||null;
}
export function usageSelectorHTML(rows,{query='',group='frequent',selectedId='',id='usage-item',name='item_id'}={}){
  const groups=buildUsageGroups(rows,{query}),chosen=groupIDs.has(group)?group:(groups.find(candidate=>candidate.rows.length)?.id||'frequent'),current=groups.find(candidate=>candidate.id===chosen),selectedItem=current.rows.find(row=>row.id===selectedId)||null;
  const labelCounts=new Map();for(const row of current.rows){const value=usageItemLabel(row);labelCounts.set(value,(labelCounts.get(value)||0)+1);}
  const optionLabel=row=>{const value=usageItemLabel(row);return labelCounts.get(value)>1?`${value} · ID ${row.id}`:value;};
  const html=`<label class="field">Category<select name="usage_group" aria-label="Usage category">${groups.map(candidate=>`<option value="${candidate.id}"${candidate.id===chosen?' selected':''}>${esc(candidate.label)}</option>`).join('')}</select></label><label class="field">Search<input name="usage_query" type="search" aria-label="Find item for usage" placeholder="Name, number or brand…" maxlength="200" value="${esc(query)}"></label><label class="field wide">Item<select id="${esc(id)}" name="${esc(name)}" required aria-label="Item for usage"><option value="">${current.rows.length?'Choose an item…':'No matching items'}</option>${current.rows.map(row=>`<option value="${esc(row.id)}"${row.id===selectedItem?.id?' selected':''}>${esc(optionLabel(row))}</option>`).join('')}</select></label>`;
  return {html,groups,group:chosen,selectedId:selectedItem?.id||'',selectedItem};
}
const blankAcronyms=new Set(['UNKNOWN','NONE','NA','N/A','UNACCOUNTED']);
function acronym(value,{historical=false}={}){
  if(typeof value!=='string')return '';
  const trimmed=value.trim(),result=historical?trimmed:trimmed.toUpperCase();
  return result.length<=80&&!blankAcronyms.has(result)&&/^[A-Z][A-Z0-9_-]{0,11}(?:\s*(?:,|\/|&|\+)\s*[A-Z][A-Z0-9_-]{0,11})*$/.test(result)?result:'';
}
export function usageLoggedBy(row,{directory=[]}={}){
  const p=row?.payload||row||{},stamp=acronym(p.recorded_by_acronym);
  if(Object.hasOwn(p,'recorded_by_user_id')||Object.hasOwn(p,'recorded_by_acronym'))return stamp||'—';
  const operator=typeof p.operator==='string'?p.operator.trim():'',historical=acronym(operator,{historical:true});
  if(historical)return historical;
  const identities=[operator,p.recorded_by].filter(value=>typeof value==='string'&&value.trim()).map(normalize);
  if(!identities.length)return '—';
  const matches=new Set();
  for(const member of directory||[]){
    const code=acronym(member.acronym);if(!code)continue;
    const aliases=[member.user_id,member.id,member.email,member.name,member.display_name,member.username,...(Array.isArray(member.aliases)?member.aliases:[])].filter(value=>typeof value==='string').map(normalize);
    if(identities.some(value=>aliases.includes(value)))matches.add(code);
  }
  return matches.size===1?[...matches][0]:'—';
}
