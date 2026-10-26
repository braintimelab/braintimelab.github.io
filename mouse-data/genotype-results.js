import {canonicalMouseSidKey,formatMouseSid} from './mouse-sid.js?v=188';
import {canonicalStrainName} from './strain-registry.js?v=146';
import {validateGeneticProfile} from './genotype-schema.js?v=100';
import {assertGenotypeProfilesPreserved} from './genotype-reconciliation.js?v=192';
import {getDeferredManagedEventTypes} from './current-record-scope.js?v=169';

export const GENOTYPE_RESULTS_LIMIT=500;
export const GENOTYPE_RESULTS_EXAMPLE='mouse_sid\tgene\tallele_1\tallele_2\tevidence\tresult_date\tkind\tchromosome\n03345\tBmal1-flox\tfl\tfl\tinferred\t2026-10-26\tflox\t11';
const copy=structuredClone,obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const text=v=>typeof v==='string'?v.trim():'',date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const archived=row=>row?.archived===true||Boolean(row?.app_archived_at),rows=(d,t)=>d?.tables?.[t]||[];
const norm=v=>canonicalStrainName(text(v)).toLowerCase(),pair=v=>JSON.stringify([...(v||[])].sort());
const reserved=new Set(['__proto__','prototype','constructor']);
const headers=new Map(Object.entries({sid:'mouse_sid',mouse_sid:'mouse_sid',mouse_id:'mouse_sid',canonical_sid:'mouse_sid',legacy_sid:'mouse_sid',sample:'sample_id',sample_id:'sample_id',sample_label:'sample_id',gene:'gene',locus:'gene',marker:'gene',locus_id:'locus_id',allele_1:'allele_1',allele1:'allele_1',allele_2:'allele_2',allele2:'allele_2',evidence:'evidence',result_date:'result_date',date:'result_date',kind:'kind',chromosome:'chromosome',genotype:'genotype',genotype_text:'genotype',method:'method',notes:'notes'}));
const plainLabel=(v,max=160)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1F\x7F]/.test(v);
const error=(row,message)=>({row:row?.row??null,message});
const unique=values=>[...new Set(values)];
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function separator(source){let quoted=false;for(let n=0;n<source.length;n++){const c=source[n];if(c==='"'){if(quoted&&source[n+1]==='"')n++;else quoted=!quoted;}else if(!quoted){if(c==='\t')return '\t';if(c==='\n'||c==='\r')break;}}return ',';}
function cells(source){const delimiter=separator(source),result=[],line=[];let value='',quoted=false,closed=false,at=1,start=1;const field=()=>{line.push(value);value='';closed=false;},record=()=>{field();if(line.some(v=>v.trim()))result.push({line:start,cells:line.slice()});line.length=0;start=at+1;};for(let i=0;i<source.length;i++){const c=source[i];if(quoted){if(c==='"'){if(source[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=c;if(c==='\n')at++;}continue;}if(c===delimiter){field();continue;}if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;record();at++;continue;}if(c==='"'){if(value.trim()||closed)throw Error(`Row ${at}: quote the complete cell.`);quoted=true;value='';continue;}if(closed&&!/\s/.test(c))throw Error(`Row ${at}: unexpected text after a quoted cell.`);if(!closed)value+=c;}if(quoted)throw Error(`Row ${start}: quoted cell is not closed.`);if(value||line.length||closed)record();return result;}

/** Long-form assay rows. Identity and scientific calls are never inferred from
 * physical tags, parentage, mouselines, or a positive/negative shorthand. */
export function parseGenotypeResults(source,{resultDate='',evidence='inferred'}={}){
 const errors=[],result=[];
 if(typeof source!=='string'||!source.trim())return {rows:[],errors:[error(null,'Paste a header and at least one genotype result.')]};
 if(source.length>1000000)return {rows:[],errors:[error(null,'Paste at most 1 MB of genotype results.')]};
 let input;try{input=cells(source.replace(/^\uFEFF/,''));}catch(e){return {rows:[],errors:[error(null,e.message)]};}
 if(input.length<2||input.length>GENOTYPE_RESULTS_LIMIT+1)return {rows:[],errors:[error(null,`Paste 1–${GENOTYPE_RESULTS_LIMIT} result rows.`)]};
 const keys=input[0].cells.map(v=>headers.get(v.trim().toLowerCase().replace(/[\s-]+/g,'_'))),seen=new Set();
 keys.forEach((key,n)=>{if(!key)errors.push(error(null,`Column ${n+1}: unsupported or blank header.`));else if(seen.has(key))errors.push(error(null,`Column ${n+1}: ${key} is repeated.`));else seen.add(key);});
 if(!seen.has('mouse_sid')&&!seen.has('sample_id'))errors.push(error(null,'Include a mouse_sid or sample_id column.'));
 if(!seen.has('gene')||!seen.has('allele_1')||!seen.has('allele_2'))errors.push(error(null,'Include gene, allele_1 and allele_2 columns. Use the bulk text editor for text-only genotype changes.'));
 if(errors.length)return {rows:[],errors};
 for(const [index,line]of input.slice(1).entries()){
  if(line.cells.length!==keys.length){errors.push(error({row:line.line},`Expected ${keys.length} cells, found ${line.cells.length}.`));continue;}
  const row={row:line.line,row_id:String(index+1)};keys.forEach((key,n)=>{row[key]=line.cells[n].trim();});row.evidence||=evidence;row.result_date||=resultDate;row.text_provided=seen.has('genotype')&&Boolean(row.genotype);result.push(row);
 }
 return {rows:errors.length?[]:result,errors};
}

function sidCandidates(dataset,value){const key=canonicalMouseSidKey(value);return rows(dataset,'mice').filter(mouse=>[mouse.mouse_sid,mouse.canonical_sid,...(Array.isArray(mouse.legacy_sids)?mouse.legacy_sids:[])].some(alias=>alias!=null&&canonicalMouseSidKey(alias)===key));}
function sampleIdentity(dataset,value){
 const samples=rows(dataset,'husbandry_events').filter(row=>row.event_type==='experiment_sample'&&(row.event_id===value||text(row.experiment_sample?.label)===value));
 const dependencies=[],sids=new Set(),issues=[];
 if(samples.length!==1)return {sids:[],dependencies,issues:[samples.length?'Sample ID/label is ambiguous; use its exact specimen record ID.':'No existing specimen matches this sample ID/label.']};
 const byId=new Map(),sampleCounts=new Map();for(const sample of rows(dataset,'husbandry_events').filter(row=>row.event_type==='experiment_sample')){byId.set(sample.event_id,sample);sampleCounts.set(sample.event_id,(sampleCounts.get(sample.event_id)||0)+1);}const visited=new Set(),active=new Set();
 function visit(sample){if(active.has(sample.event_id)){issues.push('Specimen lineage contains a cycle.');return;}if(visited.has(sample.event_id))return;if(visited.size>=400){issues.push('Specimen lineage is too large for one reviewed import.');return;}active.add(sample.event_id);visited.add(sample.event_id);dependencies.push({type:'husbandry_events',id:String(sample.event_id)});const p=sample.experiment_sample||{};
  if(archived(sample)||sample.history_read_only||sample.source_historical)issues.push('Specimen evidence is archived or read-only.');
  if(p.schema_version!==1||!Array.isArray(p.donors)||!Array.isArray(p.parent_sample_ids)||typeof p.pooled!=='boolean')issues.push('Specimen identity and pooling metadata are incomplete. Review the specimen first.');
  if(p.pooled===true)issues.push('Pooled specimens cannot establish an individual mouse genotype. Enter a verified individual mouse SID instead.');
  for(const donor of Array.isArray(p.donors)?p.donors:[]){if(donor?.link_status!=='confirmed'||!text(donor.mouse_sid)){issues.push('Specimen has an unresolved donor identity.');continue;}const matches=sidCandidates(dataset,donor.mouse_sid);if(matches.length!==1)issues.push('A specimen donor SID is missing or ambiguous.');else sids.add(String(matches[0].mouse_sid));}
  for(const id of Array.isArray(p.parent_sample_ids)?p.parent_sample_ids:[]){const parent=byId.get(id);if((sampleCounts.get(id)||0)>1)issues.push('A parent specimen ID is duplicated. Reload and resolve the specimen identity.');else if(!parent)issues.push('A parent specimen is unavailable.');else visit(parent);}active.delete(sample.event_id);
 }
 visit(samples[0]);if(sids.size!==1)issues.push(sids.size?'Specimen links to several mice; use an individually verified SID.':'Specimen has no confirmed individual mouse link.');
 return {sids:[...sids],dependencies,issues:unique(issues),sampleId:String(samples[0].event_id)};
}

export function resolveGenotypeResultIdentity(dataset,row,{resolution=null}={}){
 const issues=[],dependencies=[],ids=[];let candidates=[];
 if(text(row.mouse_sid)){
  const matches=sidCandidates(dataset,text(row.mouse_sid));candidates=unique(matches.map(mouse=>String(mouse.mouse_sid)));
  if(candidates.length!==matches.length)issues.push('Several records share the same raw mouse SID. Reload and resolve the duplicate record before importing.');
  else if(matches.length!==1){if(matches.length>1&&resolution&&candidates.includes(resolution))ids.push(resolution);else issues.push(matches.length?'SID/alias matches several mice. Review the exact existing identity.':'No existing mouse matches this SID/alias.');}else ids.push(String(matches[0].mouse_sid));
 }
 let sample=null;
 if(text(row.sample_id)){
  let complete=false;try{complete=getDeferredManagedEventTypes(dataset,{eventTypes:['experiment_sample']}).length===0;}catch{}
  if(!complete)issues.push('Load complete specimen records before resolving a sample ID or label.');
  else{sample=sampleIdentity(dataset,text(row.sample_id));issues.push(...sample.issues);dependencies.push(...sample.dependencies);if(!sample.issues.length)ids.push(sample.sids[0]);}
 }
 if(!ids.length&&!issues.length)issues.push('An existing mouse SID/alias or individually linked sample is required.');
 if(unique(ids).length>1)issues.push('The mouse SID and specimen identify different mice.');
 const mouseSid=issues.length?null:ids[0];if(mouseSid)dependencies.push({type:'mice',id:mouseSid});
 return {mouseSid,candidates,dependencies,issues:unique(issues),sampleId:sample?.sampleId??null};
}

function locusFor(dataset,mouse,row,options){
 const own=Array.isArray(mouse.genetic_profile?.loci)?mouse.genetic_profile.loci:[],catalog=rows(dataset,'mice').flatMap(m=>Array.isArray(m.genetic_profile?.loci)?m.genetic_profile.loci:[]),label=canonicalStrainName(row.gene),id=text(row.locus_id);
 let matches=id?own.filter(locus=>locus.id===id):own.filter(locus=>norm(locus.name)===norm(label));
 if(!matches.length)matches=id?catalog.filter(locus=>locus.id===id):catalog.filter(locus=>norm(locus.name)===norm(label));
 matches=[...new Map(matches.map(locus=>[JSON.stringify(locus),locus])).values()];
 if(matches.length>1)throw Error('Several locus definitions match this gene. Supply a specific locus_id and reconcile the allele catalog.');
 if(matches.length){const locus=copy(matches[0]);if(norm(locus.name)!==norm(label))throw Error('The locus_id and gene label disagree.');if(row.kind&&row.kind!==locus.kind||row.chromosome&&row.chromosome!==locus.chromosome)throw Error('The provided locus type/chromosome differs from its existing definition.');return locus;}
 const locusId=id||'result:'+encodeURIComponent(label);if(!plainLabel(locusId)||reserved.has(locusId))throw Error('Use a nonreserved locus_id of at most 160 characters.');
 const kind=row.kind||options.defaultLocusKind,chromosome=row.chromosome||options.defaultChromosome||'unknown';if(!['cre','flox','reporter','other'].includes(kind))throw Error('Choose a locus type for this new gene (cre, flox, reporter or other).');
 const alleles=unique([text(row.allele_1),text(row.allele_2)].filter(Boolean)),prior=options.newLoci.get(locusId);
 if(prior){if(norm(prior.name)!==norm(label)||prior.kind!==kind||prior.chromosome!==chromosome)throw Error('Rows for this new locus disagree on gene name, type or chromosome. Review one consistent declaration.');prior.alleles=unique([...prior.alleles,...alleles]);return prior;}
 const declared={id:locusId,name:label,kind,chromosome,alleles};options.newLoci.set(locusId,declared);return declared;
}
export function genotypeResultConflictKey(mouseSid,locusId){return JSON.stringify([mouseSid,locusId]);}
function sameCall(a,b){return Boolean(a)&&a.evidence===b.evidence&&pair(a.alleles)===pair(b.alleles);}
function summaryText(profile){return profile.loci.map(locus=>{const call=profile.calls[locus.id];return `${locus.name} (${call?.evidence==='unknown'?'unknown':call?.alleles?.join('/')||'unknown'})`;}).join('; ');}
const preparedPlans=new WeakMap();

/** Returns one reviewable proposal, never a partial write. All identity errors
 * and confirmed-call replacements are explicit and all source fields survive. */
export function prepareGenotypeResults(dataset,input,{fullGenotypeEvidence=false,specimenGuardsAllowed=false,includeArchived=false,confirmedResultsReviewed=false,reviewedReplacements=[],resolutions={},textPolicy='from_calls',defaultLocusKind='other',defaultChromosome='unknown',sourceName='Pasted results',batchId,at=new Date().toISOString(),asOf=today()}={}){
 const errors=[],warnings=[],changes=[],conflicts=[],matches=[],readDependencies=[],guarded=new Map();
 const output={errors,warnings,changes,conflicts,matches,readDependencies,batchId,at};
 if(fullGenotypeEvidence!==true){errors.push(error(null,'Complete unmasked genotype evidence is required before importing results.'));return output;}
 if(!dataset?.tables||dataset.history_projection?.read_only||!Array.isArray(input)||input.length<1||input.length>GENOTYPE_RESULTS_LIMIT){errors.push(error(null,`Open the current colony and review 1–${GENOTYPE_RESULTS_LIMIT} result rows.`));return output;}
 if(!plainLabel(batchId,100)||!/^\d{4}-\d\d-\d\dT/.test(at)||!date(at.slice(0,10))||!Number.isFinite(Date.parse(at))||!date(asOf)||!['from_calls','retain','file'].includes(textPolicy)){errors.push(error(null,'Use a valid batch identity, review timestamp and display-text policy.'));return output;}
 const accepted=new Set(reviewedReplacements),proposals=new Map(),seen=new Set(),options={defaultLocusKind,defaultChromosome,newLoci:new Map()};
 for(const row of input){
  if(!obj(row)){errors.push(error(null,'Each result must be a row object.'));continue;}
  if(text(row.sample_id)&&specimenGuardsAllowed!==true){errors.push(error(row,'Specimen identity compare-and-swap permission is required for sample-linked results. Use a reviewed mouse SID or verify the specimen permission.'));continue;}
  const identity=resolveGenotypeResultIdentity(dataset,row,{resolution:resolutions[row.row_id]});matches.push({row:row.row,row_id:row.row_id,...identity});
  for(const issue of identity.issues)errors.push(error(row,issue));if(identity.issues.length)continue;
  const mouse=rows(dataset,'mice').find(m=>String(m.mouse_sid)===identity.mouseSid);
  if(!mouse||mouse.history_read_only||mouse.source_historical||archived(mouse)&&!includeArchived){errors.push(error(row,'This mouse is archived or read-only. Explicitly include archived records only when its evidence is editable.'));continue;}
  if(mouse.state==='Ended'||mouse.end_date)warnings.push(`SID ${formatMouseSid(mouse.mouse_sid,dataset)} is ended; only genotype evidence will change.`);
  if(!plainLabel(row.gene)||!date(row.result_date)||row.result_date>asOf||date(mouse.date_of_birth)&&row.result_date<mouse.date_of_birth||!['confirmed','inferred','unknown'].includes(row.evidence)||!plainLabel(sourceName,200)){errors.push(error(row,'Record a gene, a valid result date from birth through today, and confirmed/inferred/unknown evidence.'));continue;}
  if(row.genotype!=null&&(typeof row.genotype!=='string'||row.genotype.length>2048)||row.notes!=null&&(typeof row.notes!=='string'||row.notes.length>2000)||row.method!=null&&(typeof row.method!=='string'||row.method.length>160)){errors.push(error(row,'Genotype text, method or notes exceed their text limits.'));continue;}
  if(row.evidence==='confirmed'&&!confirmedResultsReviewed)errors.push(error(row,'Confirm that you reviewed the assay evidence before recording confirmed calls.'));
  if(row.evidence!=='unknown'&&(!plainLabel(row.allele_1)||!plainLabel(row.allele_2))||row.evidence==='unknown'&&Boolean(text(row.allele_1))!==Boolean(text(row.allele_2))){errors.push(error(row,'Record two explicit allele labels, or leave both blank for unknown evidence.'));continue;}
  let locus;try{locus=locusFor(dataset,mouse,row,options);}catch(e){errors.push(error(row,e.message));continue;}
  const key=genotypeResultConflictKey(identity.mouseSid,locus.id);if(seen.has(key)){errors.push(error(row,'This mouse/locus occurs more than once. Resolve duplicate or conflicting result rows.'));continue;}seen.add(key);
  let proposed=proposals.get(identity.mouseSid);
  if(!proposed){
   const profile=mouse.genetic_profile==null?{schema_version:1,loci:[],calls:{}}:copy(mouse.genetic_profile);
   if(mouse.genetic_profile!=null&&validateGeneticProfile(profile).length){errors.push(error(row,'The existing allele profile is malformed; review it before importing replacements.'));continue;}
   if(profile.result_history!=null&&!Array.isArray(profile.result_history)){errors.push(error(row,'The existing result history needs review.'));continue;}
   proposed={original:mouse,draft:copy(mouse),profile,texts:new Set(),rows:[],updates:[]};proposals.set(identity.mouseSid,proposed);
  }
  const call={alleles:row.evidence==='unknown'&&!text(row.allele_1)?[]:[text(row.allele_1),text(row.allele_2)],evidence:row.evidence,result_date:row.result_date,recorded_at:at,result_source:{kind:'reviewed_result_import',batch_id:batchId,source_name:sourceName,input_mouse_sid:text(row.mouse_sid)||null,input_sample_id:text(row.sample_id)||null,sample_record_id:identity.sampleId,method:text(row.method)||null,notes:text(row.notes)||null}};
  if(call.alleles.some(allele=>!locus.alleles.includes(allele))){errors.push(error(row,'An allele is outside the existing locus definition. Review the catalog or correct the result label.'));continue;}
  const previous=proposed.profile.calls[locus.id],priorBatch=(proposed.profile.result_history||[]).find(item=>item?.batch_id===batchId&&item?.locus_id===locus.id);
  if(priorBatch){if(!sameCall(priorBatch.after,call)||priorBatch.after.result_date!==call.result_date||!same(priorBatch.after.result_source,call.result_source))errors.push(error(row,'This batch identity already records a different result or evidence source. Open a new reviewed batch.'));else warnings.push(`SID ${formatMouseSid(mouse.mouse_sid,dataset)}: this batch result is already recorded.`);continue;}
  const replacesConfirmed=previous?.evidence==='confirmed'&&!sameCall(previous,call),oldDate=previous?.result_date,older=oldDate&&row.result_date<oldDate;
  if(replacesConfirmed||older){conflicts.push({key,mouseSid:identity.mouseSid,locus:locus.name,before:copy(previous),after:copy(call),olderResult:Boolean(older),reviewed:accepted.has(key)});if(!accepted.has(key))errors.push(error(row,'Review and explicitly approve this replacement of a confirmed or newer allele result.'));}
  if(previous&&!sameCall(previous,call))warnings.push(`SID ${formatMouseSid(mouse.mouse_sid,dataset)}: ${locus.name} previous calls remain in result history.`);
  if(!proposed.profile.loci.some(old=>old.id===locus.id))proposed.profile.loci.push(locus);
  proposed.profile.calls[locus.id]=call;proposed.profile.result_history||=[];
  if(proposed.profile.result_history.length>=1000){errors.push(error(row,'Result history is full. Review archival handling before adding more results.'));continue;}
  proposed.profile.result_history.push({schema_version:1,batch_id:batchId,locus_id:locus.id,recorded_at:at,result_date:row.result_date,before:previous?copy(previous):null,after:copy(call),reviewed_replacement:accepted.has(key)});proposed.updates.push(locus.id);proposed.rows.push(row.row);
  if(row.text_provided)proposed.texts.add(row.genotype);
  for(const dep of identity.dependencies){readDependencies.push(dep);const target=rows(dataset,dep.type).find(record=>String(record[dep.type==='mice'?'mouse_sid':'event_id'])===dep.id);guarded.set(dep.type+':'+dep.id,{...dep,payload:copy(target)});}
 }
 if(proposals.size>200)errors.push(error(null,'Review at most 200 mice in one atomic genotype import.'));
 for(const [sid,item]of proposals){
  if(!item.updates.length)continue;
  const {draft,profile}=item;if(item.texts.size>1)errors.push(error(null,`SID ${formatMouseSid(sid,dataset)} has conflicting genotype display text in the file.`));
  if(textPolicy==='file'&&!item.texts.size)errors.push(error(null,`SID ${formatMouseSid(sid,dataset)} needs genotype text in the file, or choose another display policy.`));
  const oldText=draft.genotype??null;draft.genetic_profile=profile;
  if(textPolicy==='from_calls')draft.genotype=summaryText(profile);
  else if(textPolicy==='file'&&item.texts.size===1)draft.genotype=[...item.texts][0];
  if(textPolicy==='retain')profile.text_reconciliation={schema_version:1,status:'display_text_retained_after_results',display_text:oldText,reviewed_at:at,decision:'retain_text'};else delete profile.text_reconciliation;
  for(const entry of profile.result_history.filter(row=>row.batch_id===batchId)){entry.before_display_text=oldText;entry.after_display_text=draft.genotype??null;entry.before_genotype_date=item.original.genotype_date??null;}
  draft.genotype_status=draft.genotype?'user_entered':'not_recorded';delete draft.genotype_inference;draft.genotype_date=[item.original.genotype_date,...Object.values(profile.calls).map(call=>call?.result_date)].filter(date).sort().at(-1);draft.app_modified_at=at;
  const invalid=validateGeneticProfile(profile);for(const message of invalid)errors.push(error(null,`SID ${formatMouseSid(sid,dataset)}: ${message}`));
  if(typeof draft.genotype==='string'&&draft.genotype.length>2048)errors.push(error(null,`SID ${formatMouseSid(sid,dataset)}: display text exceeds 2,048 characters.`));
  assertGenotypeProfilesPreserved(item.original,draft);changes.push({mouseSid:sid,before:copy(item.original),after:draft,loci:item.updates,rows:item.rows});
 }
 output.readDependencies=[...new Map(readDependencies.map(dep=>[dep.type+':'+dep.id,dep])).values()];output.warnings=unique(warnings);
 if(output.readDependencies.length>500)errors.push(error(null,'This import has too many read dependencies. Split it into smaller reviewed batches.'));
 if(!errors.length)preparedPlans.set(output,{guarded:[...guarded.values()],source:dataset,fingerprint:JSON.stringify({changes:output.changes,readDependencies:output.readDependencies})});
 return output;
}

export function applyGenotypeResults(dataset,prepared){
 const plan=preparedPlans.get(prepared);if(!plan||prepared.errors.length)throw Error('Review a valid complete genotype-results proposal before saving.');
 if(plan.source!==dataset||plan.fingerprint!==JSON.stringify({changes:prepared.changes,readDependencies:prepared.readDependencies}))throw Error('The workspace or reviewed proposal changed. Review the results again.');
 for(const dep of plan.guarded){const key=dep.type==='mice'?'mouse_sid':'event_id',current=rows(dataset,dep.type).find(row=>String(row[key])===dep.id);if(!same(current,dep.payload))throw Error('A mouse or specimen changed. Reload and review the results again.');}
 const next=copy(dataset);for(const change of prepared.changes){const at=next.tables.mice.findIndex(mouse=>String(mouse.mouse_sid)===change.mouseSid);if(at<0)throw Error('A reviewed mouse is missing.');next.tables.mice[at]=copy(change.after);}return next;
}
