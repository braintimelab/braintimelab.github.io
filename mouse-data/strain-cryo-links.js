import { discoverCryoSources } from './cryo-sources.js?v=100';

const text=value=>typeof value==='string'?value:'';
const archived=row=>Boolean(row?.app_archived_at)||row?.archived===true;
const bounded=pattern=>new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?=$|[^a-z0-9])`,'i');
// Match complete line names or explicit alleles in recorded genetics fields.
// In particular, a local one-letter code or shared gene alone is not a match.
const matchers=Object.freeze([
  ['P',bounded('PER2\\s*::\\s*LUC|Per2\\s*tm1Jt')],
  ['E',bounded('Bmal1[- ]ELuc')],
  ['B',bounded('Bmal1[- ]flox(?:ed)?|(?:Arntl|Bmal1)\\s*tm1Weit')],
  ['F',bounded('FoxJ1?[- ]Cre')],
  ['V',bounded('Vip[- ]Cre|Vip\\s*tm1\\(cre\\)Zjh(?:/J)?')],
  ['AD',bounded('APP\\s*/\\s*PS1|B6\\.AD|Tg\\(APPswe,PSEN1dE9\\)85Dbo')],
  ['A',bounded('Avp[- ]Cre')],
  ['32',bounded('Ai32')],
  ['Vg',bounded('Vgat[- ]flox(?:ed)?')],
  ['Gt',bounded('GAD67[- ]tTA')],
  ['96',bounded('Ai96|Gt\\(ROSA\\)26Sor\\s*tm96\\(CAG-GCaMP6s\\)Hze')]
].map(Object.freeze));

export function strainCodesForCryo(value){
  const record=typeof value==='string'?{strain:value}:value||{};
  const candidates=[text(record.strain),text(record.gene)].filter(Boolean);
  return matchers.filter(([,pattern])=>candidates.some(candidate=>pattern.test(candidate))).map(([code])=>code);
}

const urls=source=>[...new Set((source?.sources||source?.source_snapshots?.map(row=>row.source)||[]).map(row=>row?.url).filter(url=>{try{return ['https:','http:'].includes(new URL(url).protocol)}catch{return false}}))];
const linked=(record,kind,id,outer={})=>({
  id,kind,caseId:text(record.case_id),label:text(record.label)||text(record.case_id)||text(record.strain)||id,
  strain:text(record.strain),background:text(record.background),modificationMethod:text(record.modification_method),
  gene:text(record.gene),zygosity:text(record.zygosity),origin:text(record.origin),
  batchIds:Array.isArray(record.batch_ids)?record.batch_ids.filter(value=>typeof value==='string'):[],
  sourceGroupId:kind==='source'?id:text(outer.source_case_key),sourceUrls:urls(kind==='source'?record:outer),codes:strainCodesForCryo(record)
});

/** Links are a read-only projection. No genotype, stock detail or inventory is inferred. */
export function getStrainCryoLinks(dataset,{historyIndex=null}={}){
  const records=(dataset?.tables?.husbandry_events||[]).filter(row=>row?.event_type==='cryopreservation_lot'&&typeof row.event_id==='string'&&row.event_id&&!archived(row)&&row.cryopreservation&&typeof row.cryopreservation==='object'&&!Array.isArray(row.cryopreservation));
  const covered=new Set(records.map(row=>row.source_case_key).filter(value=>typeof value==='string'&&value));
  const discovery=historyIndex?discoverCryoSources(dataset,historyIndex):null;
  const links=[
    ...records.map(row=>linked(row.cryopreservation,'managed',row.event_id,row)),
    ...(discovery?.groups||[]).filter(row=>!covered.has(row.id)).map(row=>linked(row,'source',row.id))
  ].filter(row=>row.codes.length).sort((a,b)=>a.caseId.localeCompare(b.caseId)||a.label.localeCompare(b.label)||String(a.id).localeCompare(String(b.id)));
  return {links,sourceIndexAvailable:discovery?.coverage?.full_index_available===true};
}
