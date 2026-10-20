import {esc,hazardous,itemClassification,labels,quantity,safeURL,text,inventoryArrivalDate,inventoryProductDeliveryDate,inventoryDateInfo} from './model.js?v=11';

// The caller supplies only records already authorized by the server. This module
// never fetches data, expands a filter, or includes raw source/history payloads.
const value = input => input == null ? '' : Array.isArray(input) ? input.map(text).join('; ') : text(input);
const present = input => value(input).trim() !== '';
const shown = (input,fallback='Not recorded') => present(input) ? value(input) : fallback;
const displayLabel = input => labels[input] || value(input).replaceAll('_',' ') || 'Not recorded';
const knownNumber = input => typeof input === 'number' && Number.isFinite(input) ? input : '';
const recordedBoolean = input => typeof input === 'boolean' ? input : '';

function metadata(options={}) {
  const capturedAt=options.capturedAt ?? new Date().toISOString(),date=new Date(capturedAt);
  if(!Number.isFinite(date.getTime()))throw Error('Export capture time is invalid.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
  const day=`${parts.year}-${parts.month}-${parts.day}`;
  return {dangerous:options.dangerous===true,title:options.dangerous===true?'Dangerous chemicals':'Inventory',capturedAt:date.toISOString(),day,localTime:`${day} ${parts.hour}:${parts.minute} Taipei time`,filterSummary:shown(options.filterSummary,'All items in this view')};
}

function scopedRows(rows,dangerous) {
  if(!Array.isArray(rows))throw Error('Choose inventory records to export.');
  const selected=rows.filter(row=>['item','equipment'].includes(row?.kind)&&!row.archived&&row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)&&(!dangerous||(itemClassification(row)!=='Equipment'&&hazardous(row.payload))));
  if(!selected.length)throw Error('There are no matching items to export.');
  return selected;
}

function safetySummary(payload) {
  const safety=payload.safety||{},parts=[];
  if(present(safety.classification))parts.push('Source: '+value(safety.classification));
  if(present(safety.ghs_classification))parts.push('Supplier GHS: '+value(safety.ghs_classification));
  if(present(safety.hazard_codes))parts.push(value(safety.hazard_codes));
  if(present(payload.hazard_statements))parts.push(value(payload.hazard_statements));
  if(present(safety.signal_word))parts.push(value(safety.signal_word));
  if(present(safety.regulatory_list))parts.push(value(safety.regulatory_list));
  if(!parts.length)parts.push(hazardous(payload)?'Flagged for review':'Not recorded');
  return [...new Set(parts)];
}

const INVENTORY_COLUMNS = [
  ['Record ID',(_,row)=>row.id,26],['Name',p=>p.name,34],['Category',p=>p.category,18],
  ['CAS number',p=>p.cas_number||p.cas_raw,18],['CAS as recorded',p=>p.cas_raw,18],['CAS status',p=>p.cas_status,18],['Brand',p=>p.brand,20],
  ['Catalogue number',p=>p.catalog_number,22],['Barcode / container ID',p=>p.barcode,24],['Lot / batch',p=>p.lot_number,20],
  ['Supplier',p=>p.supplier,24],['Location',p=>p.location,24],['Storage conditions',p=>p.storage,24],['Responsible person',p=>p.owner,22],
  ['Remaining amount',p=>knownNumber(p.remaining_amount),18],['Unit',p=>p.unit,12],['Quantity as recorded',p=>p.quantity_text||(knownNumber(p.remaining_amount)===''?p.remaining_amount??p.amount:''),24],
  ['Package size as recorded',p=>p.package_size_raw,24],['Containers as recorded',p=>p.container_count_raw,22],
  ['Stock status',p=>displayLabel(p.status),24],['Physical stock verified',p=>recordedBoolean(p.current_physical_stock_verified),22],
  ['In-stock date (arrival)',(p,row)=>inventoryArrivalDate(row),18],['Latest product delivery',(p,row)=>inventoryProductDeliveryDate(row),20],['Inventory date',(p,row)=>inventoryDateInfo(row).date,18],['Inventory date basis',(p,row)=>inventoryDateInfo(row).basis,24],['Opened',p=>p.opened_date,14],['Expires',p=>p.expiry_date,14],
  ['Notes',p=>p.notes,40]
];
const SAFETY_COLUMNS = [
  ['Safety flag',p=>recordedBoolean(p.safety?.flagged),14],['Regulated',p=>recordedBoolean(p.safety?.regulated),14],
  ['Source / regulatory classification',p=>p.safety?.classification,26],['Supplier GHS classification',p=>p.safety?.ghs_classification,36],['Hazard / GHS codes',p=>p.safety?.hazard_codes,26],
  ['Hazard statements',p=>p.hazard_statements,36],['Signal word',p=>p.safety?.signal_word,18],['Regulatory list',p=>p.safety?.regulatory_list,30],
  ['SDS review status',p=>displayLabel(p.safety?.review_status),24],['SDS URL',p=>p.safety?.sds_url,45],
  ['SDS region',p=>p.safety?.sds_region,16],['SDS language',p=>p.safety?.sds_language,16],['SDS retrieved',p=>p.safety?.sds_retrieved_date,16],['SDS version',p=>p.safety?.sds_version,18],['SDS date',p=>p.safety?.sds_document_date,14],
  ['SDS reviewed',p=>p.safety?.sds_review_date,14],['SDS reviewer',p=>p.safety?.sds_reviewer,22],
  ['SDS next review',p=>p.safety?.sds_next_review_date,16],['SDS hard copy reported',p=>recordedBoolean(p.safety?.sds_hard_copy_reported),22],
  ['Safety notes',p=>p.safety?.notes,40],['Review flags',p=>p.review_flags,32]
];

/** Ready for createWorkbookXlsx(). Numbers and explicit booleans remain typed. */
export function inventoryExportWorkbook(rows,options={}) {
  const meta=metadata(options),selected=scopedRows(rows,meta.dangerous),columns=[...INVENTORY_COLUMNS,...SAFETY_COLUMNS];
  const cell=input=>typeof input==='number'&&Number.isFinite(input)||typeof input==='boolean'?input:value(input);
  return {title:`Braintime Reagents · ${meta.title}`,capturedAt:meta.capturedAt,sheets:[
    {name:meta.title,rows:[columns.map(([title])=>title),...selected.map(row=>columns.map(([,read])=>cell(read(row.payload,row))))],widths:columns.map(([,read,width])=>width),frozenRows:1},
    {name:'Export details',rows:[['Field','Value'],['Report',meta.title],['Exported',meta.localTime],['Filters',meta.filterSummary],['Items',selected.length],['Safety fields','Blank fields mean not recorded; an unflagged item is not confirmation of safety.']],widths:[22,90],frozenRows:1,autoFilter:false}
  ]};
}

export function inventoryExportFilename(options={},extension='xlsx') {
  if(!['xlsx','pdf','html'].includes(extension))throw Error('Choose XLSX or PDF.');
  const meta=metadata(options);
  return `Braintime-Reagents-${meta.dangerous?'Dangerous-chemicals':'Inventory'}-${meta.day}.${extension}`;
}

const line=(label,input)=>present(input)?`<div class="export-detail"><span>${esc(label)}</span> ${esc(value(input))}</div>`:'';
function itemCell(payload,row) {
  return `<strong>${esc(shown(payload.name,row.id))}</strong>${line('',payload.category)}${line('Notes:',payload.notes)}`;
}
function identifiersCell(payload) {
  return `${line('CAS:',payload.cas_number||payload.cas_raw)}${line('Brand:',payload.brand)}${line('Cat.:',payload.catalog_number)}${line('Lot:',payload.lot_number)}${line('Container:',payload.barcode)}`||'Not recorded';
}
function storageCell(payload,row) {
  return `${esc(shown(payload.location))}${line('',payload.storage)}${line('Contact:',payload.owner)}${line('Arrived:',inventoryArrivalDate(row))}${line('Latest product delivery:',inventoryProductDeliveryDate(row))}`;
}
function quantityCell(payload) {
  return `<strong>${esc(quantity(payload))}</strong>${line('',displayLabel(payload.status))}${line('Expires:',payload.expiry_date)}`;
}
function hazardCell(payload) {
  return safetySummary(payload).map(part=>`<div>${esc(part)}</div>`).join('')+line('Notes:',payload.safety?.notes);
}
function sdsCell(payload) {
  const safety=payload.safety||{},url=safeURL(safety.sds_url);
  return `${esc(displayLabel(safety.review_status))}${line('Reviewed:',safety.sds_review_date)}${line('By:',safety.sds_reviewer)}${line('Next:',safety.sds_next_review_date)}${line('Version:',safety.sds_version)}${line('Dated:',safety.sds_document_date)}${line('Region:',safety.sds_region)}${line('Language:',safety.sds_language)}${line('Retrieved:',safety.sds_retrieved_date)}${url?`<div class="export-sds"><a href="${esc(url)}" rel="noopener noreferrer">${esc(url)}</a></div>`:line('SDS URL:',safety.sds_url)}`;
}

// Scoped styles also work in the app's dedicated print dialog. The app decides
// which surrounding elements to hide, and invokes print only on user action.
export const INVENTORY_PRINT_CSS = `
@page { size: A4 landscape; margin: 10mm; }
.inventory-print { color: #111; background: #fff; font: 10pt/1.35 Arial, "Noto Sans TC", "PingFang TC", sans-serif; }
.inventory-print * { box-sizing: border-box; }
.inventory-print h1 { margin: 0 0 2mm; font-size: 18pt; line-height: 1.2; }
.inventory-print .export-brand { margin: 0 0 1mm; font-size: 10pt; }
.inventory-print .export-meta { margin: 0 0 2mm; font-size: 9pt; overflow-wrap: anywhere; }
.inventory-print .export-legend { margin: 2mm 0; font-size: 8pt; }
.inventory-print table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
.inventory-print th, .inventory-print td { padding: 2mm; border: .2mm solid #aaa; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.inventory-print th { color: #000; background: #eee; font-weight: 700; }
.inventory-print .export-detail { margin-top: .8mm; white-space: pre-wrap; }
.inventory-print .export-detail span { font-weight: 500; }
.inventory-print .export-sds { margin-top: 1mm; font-size: 7pt; overflow-wrap: anywhere; }
.inventory-print a { color: #111; text-decoration: underline; }
.inventory-print thead { display: table-header-group; }
.inventory-print tr { break-inside: avoid; page-break-inside: avoid; }
.inventory-print .export-item { width: 23%; }
.inventory-print .export-identifiers { width: 16%; }
.inventory-print .export-storage { width: 15%; }
.inventory-print .export-quantity { width: 11%; }
.inventory-print .export-hazards { width: 17%; }
.inventory-print .export-review { width: 18%; }
@media print {
  .inventory-print { width: 100%; padding: 0; }
  .inventory-print h1, .inventory-print .export-meta { break-after: avoid; }
  .inventory-print th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

/** HTML fragment for a permission-fenced preview. No scripts, inline events or remote assets. */
export function inventoryPrintBodyHTML(rows,options={}) {
  const meta=metadata(options),selected=scopedRows(rows,meta.dangerous);
  return `<article class="inventory-print"><p class="export-brand">Braintime Reagents</p><h1>${esc(meta.title)}</h1><p class="export-meta">${esc(meta.localTime)} · ${selected.length.toLocaleString('en-US')} ${selected.length===1?'item':'items'}<br>${esc(meta.filterSummary)}</p><table><colgroup><col class="export-item"><col class="export-identifiers"><col class="export-storage"><col class="export-quantity"><col class="export-hazards"><col class="export-review"></colgroup><thead><tr><th>Reagent</th><th>Identifiers</th><th>Location / storage</th><th>Quantity / status</th><th>Classification / GHS</th><th>SDS review</th></tr></thead><tbody>${selected.map(row=>{const p=row.payload;return `<tr><td>${itemCell(p,row)}</td><td>${identifiersCell(p)}</td><td>${storageCell(p,row)}</td><td>${quantityCell(p)}</td><td>${hazardCell(p)}</td><td>${sdsCell(p)}</td></tr>`;}).join('')}</tbody></table><p class="export-legend">Safety fields show recorded information. Unrecorded or unflagged does not mean safe.</p></article>`;
}

/** Standalone print-ready HTML, also useful for saved preview artifacts. */
export function inventoryPrintHTML(rows,options={}) {
  const meta=metadata(options);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Braintime Reagents · ${esc(meta.title)}</title><style>${INVENTORY_PRINT_CSS}</style></head><body>${inventoryPrintBodyHTML(rows,{...options,capturedAt:meta.capturedAt})}</body></html>`;
}
