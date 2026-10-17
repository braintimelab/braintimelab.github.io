import { JAX_STRAIN_REFERENCES } from './strain-reference-data.js?v=118';
/* Animal Sheet strain codes. These labels describe lines, not individual genotype calls. */
export const INSERTION_TYPES=Object.freeze([
  Object.freeze({value:'unknown',label:'Unknown'}),
  Object.freeze({value:'transgenic',label:'Transgenic (random insertion)'}),
  Object.freeze({value:'knock_in',label:'Knock-in'})
]);
const insertionTypes=new Set(INSERTION_TYPES.map(row=>row.value));
// Optional stock-level metadata. Empty values mean the local stock has not been
// verified; gene aliases must never be used to infer a promoter or allele.
export const STRAIN_DETAIL_FIELDS=Object.freeze([
  {key:'formal_name',label:'Formal strain name',limit:500},
  {key:'gene_symbol',label:'Gene / locus symbol',limit:200},
  {key:'allele_symbol',label:'Allele symbol',limit:500},
  {key:'promoter',label:'Promoter / regulatory sequence',limit:500},
  {key:'construct',label:'Construct / targeted change',limit:1000,multiline:true},
  {key:'reporter',label:'Reporter',limit:500},
  {key:'recombinase',label:'Recombinase',limit:500},
  {key:'genetic_background',label:'Local genetic background',limit:500},
  {key:'catalog_background',label:'Reference background',limit:500},
  {key:'strain_source',label:'Source / supplier',limit:500},
  {key:'references',label:'References / links',limit:1500,multiline:true},
  {key:'genotyping_notes',label:'Genotyping notes',limit:2000,multiline:true}
].map(Object.freeze));
// Laboratory naming clarification. These aliases never rewrite imported text,
// stable locus IDs or saved Cre models, and do not define a new acronym.
export const FLOX_STRAIN_NAMES=Object.freeze(['Bmal1-flox','Meis1-flox','Vgat-flox']);
export const FOXJ1_STRAIN_NAME='FoxJ1-CreERT2';
export const FOXJ1_STRAIN_ALIASES=Object.freeze(['FoxJ1-CreERT2','FoxJ-CreERT2','FoxJ1-Cre','FoxJ-Cre','FoxJ1-ERT-Cre','FoxJ-ERT-Cre','FoxJ1-ERT2-Cre','FoxJ-ERT2-Cre']);
export const legacyVgatCreName=value=>typeof value==='string'&&/^Vgat-Cre$/i.test(value.trim());
export function canonicalStrainName(value){
  const text=typeof value==='string'?value.trim():'';if(FOXJ1_STRAIN_ALIASES.some(name=>name.toLowerCase()===text.toLowerCase()))return FOXJ1_STRAIN_NAME;if(legacyVgatCreName(text))return 'Vgat-flox';const match=text.match(/^(Bmal1|Meis1|Vgat)(?:[- ]+flox(?:ed)?)?$/i);
  return match?FLOX_STRAIN_NAMES.find(name=>name.toLowerCase().startsWith(match[1].toLowerCase()+'-')):text;
}
export function strainNameAliases(value){
  const canonical=canonicalStrainName(value);
  if(canonical===FOXJ1_STRAIN_NAME)return [...FOXJ1_STRAIN_ALIASES];
  if(!FLOX_STRAIN_NAMES.includes(canonical))return [value];
  const gene=canonical.slice(0,-5);return [canonical,gene,`${gene} flox`,`${gene}-floxed`,`${gene} floxed`,...(gene==='Vgat'?['Vgat-Cre']:[])];
}
export const explicitCreName=value=>typeof value==='string'&&/-Cre(?:ERT?2?)?$/i.test(value.trim());
export function canonicalLocusName(locus){return locus?.kind==='cre'&&FLOX_STRAIN_NAMES.includes(canonicalStrainName(locus.name))?locus.name:canonicalStrainName(locus?.name);}
export function strainNamingWarning(locus){
  const name=typeof locus==='string'?locus:locus?.name;
  if(locus?.kind==='cre'&&(legacyVgatCreName(name)||/^Vgat$/i.test(name||'')))return 'Saved Vgat Cre model needs review: the lab uses Vgat-CRE as a legacy name for Vgat-flox. Original Cre alleles were retained; verify the floxed allele before changing this model.';
  if(legacyVgatCreName(name))return 'Vgat-CRE is a legacy lab name for Vgat-flox. Explicit floxed-allele evidence is required; old Cre +/- notation does not establish flox zygosity.';
  return /^Vgat-CreERT?2?$/i.test(name||'')?'This Vgat Cre variant is not covered by the lab’s Vgat-CRE alias. Review the original stock or allele.':'';
}
export function strainNamingHelpHTML(){return '<p class="subtle">Laboratory names: Bmal1 = Bmal1-flox; Meis1 = Meis1-flox; Vgat = Vgat-flox (Vg). Meis1-flox has no confirmed shorthand. Bmal1-ELuc (E) is separate. F = FoxJ1-CreERT2 (JAX 027012); FoxJ1-Cre and FoxJ-Cre are legacy names. Vgat-CRE is a legacy lab name for Vgat-flox; old Cre +/- notation does not establish flox zygosity. Saved Cre models require review before conversion. Original source text is preserved.</p>';}

const definition=(key,name,insertionType='unknown',notes='',origin='Animal Sheet legend',stockReference='')=>Object.freeze({key,name,insertionType,notes,origin,stockReference});
export const STRAIN_ACRONYMS=Object.freeze([
  definition('P','PER2::LUC','knock_in','','Animal Sheet legend; laboratory confirmation'),
  definition('E','Bmal1-ELuc','transgenic','','Animal Sheet legend; laboratory confirmation'),
  definition('B','Bmal1-flox','knock_in','','Animal Sheet legend; laboratory confirmation'),
  definition('F',FOXJ1_STRAIN_NAME,'knock_in','','Animal Sheet legend; laboratory JAX records','JAX 027012'),
  definition('V','Vip-Cre','knock_in','','Animal Sheet legend; laboratory confirmation'),
  definition('AD','APP/PS1','transgenic','APPswe and PSEN1dE9 transgenes share a chromosome 9 insertion site (MGI:3524957).','Animal Sheet stock reference and MGI','JAX 005864; Tg(APPswe,PSEN1dE9)85Dbo'),
  definition('A','Avp-Cre','knock_in','','Animal Sheet legend; laboratory JAX records','JAX 023530'),
  definition('32','Ai32'),
  definition('Vg','Vgat-flox'),
  definition('Gt','GAD67-tTA'),
  definition('96','Ai96')
]);
const defaults=new Map(STRAIN_ACRONYMS.map(row=>[row.key,row]));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const eventId=code=>'STRAIN-'+code;
const archived=record=>Boolean(record?.app_archived_at)||record?.archived===true;
const eventDate=now=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

export function validateStrainDefinition(record,old=null) {
  const relevant=record?.event_type==='strain_definition'||record?.strain_definition!==undefined||old?.event_type==='strain_definition'||old?.strain_definition!==undefined;
  if(!relevant)return [];
  const errors=[];
  if(record?.event_type!=='strain_definition')errors.push('A strain definition must retain its strain_definition event type.');
  const value=record?.strain_definition;
  if(!object(value))return [...errors,'A strain definition is required.'];
  if(value.schema_version!==1)errors.push('Unsupported strain definition version.');
  const reference=defaults.get(value.code);
  if(!reference)errors.push('Choose a strain code from the Animal Sheet legend.');
  if(reference&&canonicalStrainName(value.name)!==reference.name)errors.push('The strain name must match its Animal Sheet code.');
  if(record.event_id!==eventId(value.code))errors.push('A strain definition must use its stable strain ID.');
  if(old?.strain_definition?.code&&old.strain_definition.code!==value.code)errors.push('A saved strain code cannot change.');
  if(old?.event_id&&old.event_id!==record.event_id)errors.push('A saved strain definition ID cannot change.');
  if(!insertionTypes.has(value.insertion_type))errors.push('Choose Unknown, Transgenic or Knock-in.');
  if(typeof value.stock_reference!=='string'||value.stock_reference.length>500)errors.push('Stock reference must be text of at most 500 characters.');
  if(typeof value.notes!=='string'||value.notes.length>2000)errors.push('Strain notes must be text of at most 2000 characters.');
  for(const field of STRAIN_DETAIL_FIELDS)if(value[field.key]!==undefined&&(typeof value[field.key]!=='string'||value[field.key].length>field.limit))errors.push(`${field.label} must be text of at most ${field.limit} characters.`);
  if(!dateValid(record.event_date))errors.push('A valid strain-definition date is required.');
  return errors;
}

export function getStrainRegistry(dataset) {
  const saved=new Map();
  for(const record of dataset?.tables?.husbandry_events||[]) {
    if(record?.event_type!=='strain_definition'||archived(record)||validateStrainDefinition(record).length)continue;
    const previous=saved.get(record.strain_definition.code);
    if(!previous||String(record.app_modified_at||record.event_date)>String(previous.app_modified_at||previous.event_date))saved.set(record.strain_definition.code,record);
  }
  return STRAIN_ACRONYMS.map(reference=>{
    const record=saved.get(reference.key),value=record?.strain_definition;
    const catalog=JAX_STRAIN_REFERENCES[reference.key],details=Object.fromEntries(STRAIN_DETAIL_FIELDS.map(field=>[field.key,value?.[field.key]??catalog?.fields[field.key]??'']));
    return value?{...reference,...details,jaxReference:catalog,insertionType:value.insertion_type,stockReference:value.stock_reference,notes:value.notes,origin:'Colony strain registry',eventId:record.event_id,modifiedAt:record.app_modified_at||record.event_date}:{...reference,...details,jaxReference:catalog,insertionType:catalog?.fields.insertion_type||reference.insertionType,stockReference:catalog?.fields.stock_reference||reference.stockReference};
  });
}

export function buildStrainDefinition(dataset,input,options={}) {
  const code=input?.code,reference=defaults.get(code);
  if(!reference)throw new Error('Choose a strain code from the Animal Sheet legend.');
  const next=structuredClone(dataset||{tables:{}});
  next.tables??={};next.tables.husbandry_events??=[];
  const matches=next.tables.husbandry_events.filter(row=>row.event_id===eventId(code));
  if(matches.length>1)throw new Error('Duplicate strain definitions must be resolved before editing.');
  const original=matches[0];
  if(original&&original.event_type!=='strain_definition')throw new Error('The strain ID is already used by another record.');
  if(original&&archived(original))throw new Error('This strain definition is archived. Restore it before editing.');
  const clock=options.now===undefined?new Date():new Date(options.now);
  if(Number.isNaN(clock.getTime()))throw new Error('A valid modification time is required.');
  const details=Object.fromEntries(STRAIN_DETAIL_FIELDS.map(field=>{
    const value=Object.hasOwn(input,field.key)?input[field.key]:original?.strain_definition?.[field.key]??'';
    return [field.key,typeof value==='string'?value.trim():value];
  }));
  const record={...original,event_id:eventId(code),event_type:'strain_definition',event_date:options.eventDate??eventDate(clock),record_origin:original?.record_origin||'app_created',app_created_at:original?.app_created_at||clock.toISOString(),app_modified_at:clock.toISOString(),strain_definition:{...original?.strain_definition,...details,schema_version:1,code,name:reference.name,insertion_type:input.insertion_type,stock_reference:typeof input.stock_reference==='string'?input.stock_reference.trim():input.stock_reference,notes:typeof input.notes==='string'?input.notes.trim():input.notes}};
  const errors=validateStrainDefinition(record,original);
  if(errors.length)throw new Error(errors.join(' '));
  const index=next.tables.husbandry_events.findIndex(row=>row.event_id===record.event_id);
  if(index<0)next.tables.husbandry_events.push(record);else next.tables.husbandry_events[index]=record;
  return {record,dataset:next};
}
