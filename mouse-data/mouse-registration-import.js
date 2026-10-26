import {canonicalMouseSidKey,formatMouseSid} from './mouse-sid.js?v=188';

const MAX_ROWS=100;
const aliases=new Map(Object.entries({
 sid:'mouse_sid',mouse_sid:'mouse_sid',mouse_id:'mouse_sid',
 physical_tag:'physical_tag',tag:'physical_tag',animal_tag:'physical_tag',
 sex:'sex',gender:'sex',date_of_birth:'date_of_birth',dob:'date_of_birth',birth_date:'date_of_birth',
 genotype:'genotype',mouseline:'mouseline',mouse_line:'mouseline',manager:'manager',
 cage_sid:'cage_sid',cage:'cage_sid',cage_tag:'cage_tag',
 sire_sids:'sire_sids',sire_sid:'sire_sids',sire:'sire_sids',
 dam_sids:'dam_sids',dam_sid:'dam_sids',dam:'dam_sids',
 ear_mark:'ear_mark',earmark:'ear_mark',notes:'notes',note:'notes',comment:'comment',
 litter_sid:'litter_sid',litter:'litter_sid',state:'state',status:'status',protocol:'protocol',strain:'strain'
}));
const headerKey=value=>String(value).trim().toLowerCase().replace(/[\s-]+/g,'_');
const sidKey=canonicalMouseSidKey;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

/** Read the separator only outside quoted cells, so a quoted tag containing a
 * tab does not turn a CSV into TSV. Pasted spreadsheets normally use tabs. */
function delimiterOf(source){let quoted=false,commas=0,tabs=0;for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted){if(c==='\t')tabs++;else if(c===',')commas++;else if(c==='\n'||c==='\r')break;}}return tabs?'\t':',';}

function cellsOf(source,separator){
 const rows=[],row=[];let cell='',quoted=false,closed=false,line=1,rowLine=1;
 const pushCell=()=>{row.push(cell);cell='';closed=false;};
 const pushRow=()=>{pushCell();rows.push({cells:row.splice(0),line:rowLine});rowLine=line+1;};
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
  if(c===separator){pushCell();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;pushRow();line++;continue;}
  if(c==='"'){if(cell.trim()||closed)throw Error(`Row ${line}: unexpected quote. Quote the complete cell.`);cell='';quoted=true;continue;}
  if(closed&&!/\s/.test(c))throw Error(`Row ${line}: unexpected text after a quoted cell.`);
  if(!closed)cell+=c;
 }
 if(quoted)throw Error(`Row ${rowLine}: the quoted cell is not closed.`);
 if(cell||row.length||closed)pushRow();
 return rows;
}

export const MOUSE_REGISTRATION_SHEET_EXAMPLE='sex\tphysical_tag\tdate_of_birth\tgenotype\nMale\t\t2026-10-01\tPER2::LUC (+/-)\nFemale\t\t2026-10-01\tPER2::LUC (+/-)';
export const MOUSE_REGISTRATION_SHEET_HELP='Paste up to 100 rows from a spreadsheet, including the header row. Use sex, tag, dob, genotype, cage, manager, sire_sids, dam_sids, ear_mark or notes. Dates use YYYY-MM-DD. Blank cells use the shared details. Leave SID blank for automatic consecutive SIDs. Supplied SIDs must be numbers from 1 to 99999; they are padded to five digits and checked for duplicates. The original spelling is retained when padding changes it.';

/** Parse registration rows only. No IDs are generated and no records are
 * mutated here: pasted rows use the same registration transaction as the form.
 * Supplied numeric SIDs become five-digit text. The exact supplied spelling is
 * retained in original_sid whenever normalization changes it. Irregular source
 * identities require review instead of being silently assigned another ID. */
export function parseMouseRegistrationRows(text,defaults={}){
 const errors=[],drafts=[];
 if(typeof text!=='string'||!text.trim())return {drafts,errors:['Paste the header row and at least one mouse row.']};
 if(text.length>1000000)return {drafts,errors:['The pasted sheet is too large. Paste at most 100 mouse rows.']};
 let rows;try{const source=text.replace(/^\uFEFF/,'');rows=cellsOf(source,delimiterOf(source)).filter(row=>row.cells.some(cell=>cell.trim()));}catch(error){return {drafts,errors:[error.message]};}
 if(rows.length<2)return {drafts,errors:['Paste the header row and at least one mouse row.']};
 if(rows.length-1>MAX_ROWS)return {drafts,errors:['Paste at most 100 mouse rows at a time.']};
 const headers=rows[0].cells.map(value=>aliases.get(headerKey(value))),seenHeaders=new Set();
 for(let i=0;i<headers.length;i++){const field=headers[i],label=rows[0].cells[i].trim();if(!field)errors.push(`Column ${i+1}: ${label?'unsupported header "'+label+'".':'a header is required.'}`);else if(seenHeaders.has(field))errors.push(`Column ${i+1}: ${field} appears more than once.`);else seenHeaders.add(field);}
 if(errors.length)return {drafts,errors};
 const seenSids=new Map();
 for(const row of rows.slice(1)){
  if(row.cells.length!==headers.length){errors.push(`Row ${row.line}: expected ${headers.length} cells, found ${row.cells.length}.`);continue;}
  const draft={...structuredClone(defaults),mouse_sid:null,record_origin:'app_created'};
  delete draft.original_sid;
  for(let i=0;i<headers.length;i++){
   const field=headers[i],value=row.cells[i].trim();
   if(field==='mouse_sid'){
    if(!value){draft.mouse_sid=null;continue;}
    if(!/^\d+$/.test(value)||BigInt(value)<1n||BigInt(value)>99999n){errors.push(`Row ${row.line}: SID "${value}" must be a whole number from 1 to 99999. Review the source ID or leave SID blank for automatic numbering.`);continue;}
    draft.mouse_sid=formatMouseSid(value);
    if(draft.mouse_sid!==value)draft.original_sid=value;
    continue;
   }
   if(!value)continue;
   if(field==='sex'){
    const normalized={m:'Male',male:'Male','♂':'Male',f:'Female',female:'Female','♀':'Female',u:'Unknown',unknown:'Unknown','?':'Unknown'}[value.toLowerCase()];
    if(!normalized)errors.push(`Row ${row.line}: sex must be Male, Female or Unknown.`);else draft.sex=normalized;
   }else if(field==='date_of_birth'){
    if(!validDate(value))errors.push(`Row ${row.line}: date of birth must be a valid YYYY-MM-DD date.`);else draft[field]=value;
   }else if(['sire_sids','dam_sids'].includes(field)){
    const ids=value.split(/[,;]+/).map(id=>id.trim()).filter(Boolean),unique=new Set(ids.map(sidKey));
    if(unique.size!==ids.length)errors.push(`Row ${row.line}: ${field} contains a duplicate SID.`);else draft[field]=ids;
   }else draft[field]=value;
  }
  // A per-row destination must not inherit the shared cage's label. The batch
  // preparer resolves the new cage's recorded tag when the row leaves it blank.
  const cageColumn=headers.indexOf('cage_sid'),tagColumn=headers.indexOf('cage_tag');
  if(cageColumn>=0&&row.cells[cageColumn].trim()&&String(draft.cage_sid)!==String(defaults.cage_sid||'')&&(tagColumn<0||!row.cells[tagColumn].trim()))delete draft.cage_tag;
  draft.sex??='Unknown';draft.state??='Stock';draft.sire_sids??=[];draft.dam_sids??=[];
  if(draft.mouse_sid){const key=sidKey(draft.mouse_sid);if(seenSids.has(key))errors.push(`Row ${row.line}: SID ${draft.mouse_sid} duplicates row ${seenSids.get(key)}.`);else seenSids.set(key,row.line);}
  drafts.push(draft);
 }
 // Never return a partially usable batch after a malformed row.
 return {drafts:errors.length?[]:drafts,errors};
}
