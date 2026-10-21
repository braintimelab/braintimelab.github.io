import {canExport,canReadRecord,canViewSection,itemClassification,itemName} from './model.js?v=11';
export const LABSAFE_MANUAL_URL='https://labsafe.tmu.edu.tw/zh-TW/ChemicalsManualPurchase/Apply';
export function canPrepareLabSafe(permissions){
 if(!permissions||(permissions.guest_level??permissions.guestLevel)!=null)return false;
 const tier=permissions.export_level??permissions.exportLevel,eligible=['owner','manager'].includes(permissions.role)||['editor','viewer'].includes(permissions.role)&&['high','max'].includes(tier);
 return eligible&&canViewSection(permissions,'safety')&&canExport(permissions);
}
const scalar=value=>typeof value==='string'?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):'';
const first=(...values)=>values.map(scalar).find(Boolean)||'';
const joined=value=>Array.isArray(value)?value.map(scalar).filter(Boolean).join(' · '):scalar(value);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const chemical=row=>Boolean(row?.id&&row.kind==='item'&&!row.archived&&row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)&&itemClassification(row)==='Chemicals'&&!['historical','disposed','depleted','out_of_stock'].includes(row.payload.status));
export function labSafePreparationRows(rows,permissions){
 if(!canPrepareLabSafe(permissions)||!Array.isArray(rows))return[];
 return rows.filter(row=>chemical(row)&&canReadRecord(permissions,row));
}
const fieldDefinitions=[
 ['laboratory','LabSafe laboratory',true,'Choose the laboratory in LabSafe; an app location is not a laboratory selection.'],
 ['cas','CAS number',true,'Confirm the exact substance and concentration with the LabSafe catalogue.'],
 ['regulatory_number','Regulatory number',false,'Copy only a recorded number; use the catalogue to verify applicability.'],
 ['product_name','Product name',true,'Review the product identity and the actual bottle.'],
 ['supplier','Supplier',true,'Confirm the supplier for this purchase.'],
 ['brand','Brand',true,'Confirm the brand for this product.'],
 ['concentration','Concentration (%)',true,'Confirm concentration and percentage basis; no concentration is inferred.'],
 ['per_bottle','Per-bottle amount as recorded',true,'Review the portal unit. A volume cannot be converted to mass without verified density.'],
 ['container_shape','Container shape',true,'Choose the actual container shape in LabSafe.'],
 ['sds_date','SDS date',true,'Use the current supplier SDS date.'],
 ['sds_file','SDS file',true,'Attach the reviewed SDS file manually in LabSafe; a URL is not an uploaded file.'],
 ['invoice_file','Invoice file',true,'Attach the relevant invoice manually in LabSafe.'],
 ['emergency_phone','Emergency phone',true,'Confirm the appropriate emergency contact.'],
 ['bottle_count','Bottle count',true,'Confirm the actual bottle/container count, not the remaining amount.'],
 ['total_weight_kg','Purchase total weight (kg)',false,'The portal calculates total weight. Copy only an explicitly recorded purchase mass; remaining stock is not purchase weight.']
];
function recordedRegulatoryNumber(value){const parts=(Array.isArray(value)?value:[value]).flatMap(value=>scalar(value).split(/[、,;·|\r\n]/)).map(value=>value.trim()).filter(Boolean);return parts.length&&parts.every(value=>/^\d{3}-\d{2}$/.test(value))&&new Set(parts).size===1?parts[0]:'';}
function sourceFields(row){
 const p=row.payload,s=p.safety||{},perBottle=first(p.per_bottle_weight,p.per_bottle_amount),perUnit=first(p.per_bottle_unit,p.per_bottle_weight_unit);
 return{laboratory:first(p.labsafe_laboratory,p.labsafe_lab),cas:first(p.cas_number,p.cas_raw),regulatory_number:first(s.regulatory_number,s.control_number,p.regulatory_number,p.control_number,recordedRegulatoryNumber(s.regulatory_list)),product_name:first(p.name,p.title),supplier:scalar(p.supplier),brand:scalar(p.brand),concentration:first(p.concentration_percent,p.concentration_wt_percent,p.concentration_raw,p.concentration),per_bottle:perBottle?[perBottle,perUnit].filter(Boolean).join(' '):'',container_shape:first(p.container_shape,p.container_type),sds_date:scalar(s.sds_document_date),sds_file:'',invoice_file:'',emergency_phone:scalar(p.emergency_phone),bottle_count:first(p.bottle_count,p.container_count,p.container_count_raw),total_weight_kg:scalar(p.purchase_total_weight_kg)};
}
/** A row stays a row: no CAS merge, inferred bottle identity, stock balance or unit conversion. */
export function prepareLabSafeRow(row,{overrides={}}={}){
 if(!chemical(row))throw Error('Choose a current chemical Inventory row. Historical evidence and equipment cannot be prepared as current stock.');
 const p=row.payload,s=p.safety||{},source=sourceFields(row),fields=fieldDefinitions.map(([key,label,required,help])=>{
  const value=Object.hasOwn(overrides,key)?scalar(overrides[key]):source[key];if(value.length>10000)throw Error('A preparation field is too long. Review the original record.');
  let reason=!value&&required?'Needs check: not recorded.':'';
  if(value&&key==='cas'&&!/^\d{2,7}-\d{2}-\d$/.test(value))reason='Needs check: confirm one exact catalogue CAS; mixtures are not resolved automatically.';
  if(value&&key==='concentration'&&(!/^\d+(?:\.\d+)?$/.test(value)||Number(value)>100))reason='Needs check: confirm the numeric percentage and its basis.';
  if(value&&key==='per_bottle')reason='Needs check: confirm the amount and portal unit; no density or mass conversion was made.';
  if(value&&key==='bottle_count'&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1))reason='Needs check: confirm a positive integer bottle count.';
  if(value&&key==='total_weight_kg'&&(!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)<=0))reason='Needs check: confirm a positive purchase mass explicitly in kg.';
  if(value&&key==='sds_date'&&!validDate(value))reason='Needs check: confirm a valid SDS document date.';
  if(['sds_file','invoice_file'].includes(key))reason='Needs check: attach the actual file manually in LabSafe.';
  return{key,label,required,value,sourceValue:source[key],help,needsCheck:Boolean(reason),reason};
 });
 const stockAmount=first(p.quantity_text,p.remaining_amount,p.amount),stockUnit=scalar(p.unit),stock=stockAmount;
 return{id:row.id,version:row.version??null,name:itemName(row),fields,source:{barcode:scalar(p.barcode),lot:scalar(p.lot_number),stockQuantity:stock,stockUnit,packageSize:scalar(p.package_size_raw),location:scalar(p.location),categories:joined(s.classification),regulatoryList:joined(s.regulatory_list),toxicClass:first(s.toxic_class,s.toxicity_class,s.toxic_chemical_class,p.toxic_class),ghs:joined(s.ghs_classification),hazardCodes:joined(s.hazard_codes),sdsURL:scalar(s.sds_url),physicalStockVerified:p.current_physical_stock_verified===true}};
}
export function labSafeDraftWorkbook(rows,{permissions,overridesById={},capturedAt=new Date().toISOString()}={}){
 if(!canPrepareLabSafe(permissions))throw Error('LabSafe preparation is available from High level upward, with Dangerous chemicals and export access.');
 const selected=labSafePreparationRows(rows,permissions);if(!selected.length||selected.length>500)throw Error('Choose between 1 and 500 current chemical rows; narrow the current filters.');
 if(!Number.isFinite(Date.parse(capturedAt)))throw Error('Choose a valid capture time.');
 const prepared=selected.map(row=>prepareLabSafeRow(row,{overrides:overridesById[row.id]||{}})),columns=['Record ID','Record version',...fieldDefinitions.map(([,label])=>label),'Needs check','Stock quantity as recorded','Stock unit as recorded','Package size as recorded','Barcode / container ID','Lot / batch','Location','Recorded categories','Regulatory list as recorded','Explicit toxic class as recorded','GHS classification as recorded','Hazard codes as recorded','Supplier SDS URL'];
 return{title:'LabSafe preparation draft',capturedAt,sheets:[{name:'Preparation draft',rows:[columns,...prepared.map(row=>[row.id,row.version??'',...row.fields.map(field=>field.value),row.fields.filter(field=>field.needsCheck).map(field=>field.label+': '+field.reason).join('\n'),row.source.stockQuantity,row.source.stockUnit,row.source.packageSize,row.source.barcode,row.source.lot,row.source.location,row.source.categories,row.source.regulatoryList,row.source.toxicClass,row.source.ghs,row.source.hazardCodes,row.source.sdsURL])],widths:columns.map((_,i)=>i===17?70:24),frozenRows:1},{name:'Read first',rows:[['Field','Information'],['Status','Preparation only · Review and submit in LabSafe'],['Template','Generic review draft, not a verified LabSafe import template. No import option was confirmed.'],['Official portal',LABSAFE_MANUAL_URL],['Scope','Current selected Inventory rows only. No historical rows, no CAS deduplication and no stock or monthly balance aggregation.'],['Units','Source quantities and units are preserved. No density, volume-to-mass or inferred purchase-weight conversion.'],['Files','SDS and invoice files must be selected and uploaded by the user in LabSafe.'],['Official permissions','LabSafe has separate account permissions. This draft does not submit, confirm or lock an official report.'],['Captured',new Date(capturedAt).toISOString()],['Rows',prepared.length]],widths:[24,105],frozenRows:1,autoFilter:false}]};
}
const node=(tag,cls='',text='')=>{const value=document.createElement(tag);value.className=cls;value.textContent=text;return value;};
const button=(label,handler)=>{const value=node('button','',label);value.type='button';value.addEventListener('click',handler);return value;};
/** In-memory preparation only. Every clipboard or file export rechecks live access. */
export function createLabSafePreparationUI({getRows,getPermissions,getContext,verifyAccess,createWorkbook,download,clipboard=globalThis.navigator?.clipboard}){
 let generation=0,dialog=null,context=null,busy=false,controls=[],selection='',drafts=new Map(),ui=null;
 const current=epoch=>Boolean(dialog&&epoch===generation&&context===getContext()&&canPrepareLabSafe(getPermissions()));
 function clear(){generation++;dialog?.close();dialog?.remove();dialog=null;context=null;busy=false;controls=[];selection='';drafts.clear();ui=null;}
 function check(epoch){if(!current(epoch)){if(epoch===generation)clear();throw Object.assign(Error('Your access or view changed. Reopen preparation.'),{code:'PREPARATION_CONTEXT_CHANGED'});}}
 function rows(){const result=labSafePreparationRows(getRows(),getPermissions());if(result.length>500)throw Error('Narrow the current view to 500 chemical rows or fewer.');return result;}
 const selectedRow=()=>rows().find(row=>row.id===selection);
 function paintBusy(){for(const control of controls)control.disabled=busy;dialog?.setAttribute('aria-busy',String(busy));}
 async function authorized(work){if(busy||!dialog)return;const epoch=generation;busy=true;paintBusy();try{check(epoch);const result=await verifyAccess();check(epoch);if(!canPrepareLabSafe(result?.permissions??result))throw Object.assign(Error('Preparation access is no longer available.'),{reagentsAccessChanged:true,status:403});await work(epoch);check(epoch);}catch(error){if(epoch===generation&&dialog){if(!current(epoch)||error?.reagentsAccessChanged||[401,403].includes(error?.status)){clear();return;}ui.feedback.textContent=error.message||'Could not complete. Your draft is retained.';}}finally{if(epoch===generation){busy=false;paintBusy();}}}
 async function copyField(key){return authorized(async epoch=>{const row=selectedRow();if(!row)throw Error('This chemical row is no longer available.');const field=prepareLabSafeRow(row,{overrides:drafts.get(selection)||{}}).fields.find(field=>field.key===key);if(!field?.value)throw Error('Enter and review a value before copying.');check(epoch);try{if(!clipboard?.writeText)throw Error();await clipboard.writeText(field.value);check(epoch);ui.feedback.textContent='Copied '+field.label+'. Review the field and unit in LabSafe.';ui.fallback.hidden=true;ui.fallback.value='';}catch(error){check(epoch);ui.fallback.hidden=false;ui.fallback.value=field.value;ui.fallback.focus();ui.fallback.select();ui.feedback.textContent='Clipboard unavailable. Select and copy this value manually.';}});}
 async function exportDraft(all=false){return authorized(async epoch=>{const selected=all?rows():[selectedRow()].filter(Boolean);const permissions=getPermissions(),overridesById=Object.fromEntries(drafts),workbook=labSafeDraftWorkbook(selected,{permissions,overridesById}),blob=await createWorkbook(workbook);check(epoch);download(blob,'Braintime-LabSafe-preparation-draft-'+workbook.capturedAt.slice(0,10)+'.xlsx');ui.feedback.textContent='Draft downloaded. Review and submit manually in LabSafe.';});}
 function renderFields(){
  ui.fields.replaceChildren();ui.fallback.hidden=true;ui.fallback.value='';const row=selectedRow();if(!row){ui.feedback.textContent='No current chemical row is available.';return;}const prepared=prepareLabSafeRow(row,{overrides:drafts.get(selection)||{}}),source=prepared.source;ui.source.textContent=[source.stockQuantity&&'Stock as recorded: '+source.stockQuantity+(source.stockUnit?' (unit: '+source.stockUnit+')':''),source.packageSize&&'Package: '+source.packageSize,source.barcode&&'Container: '+source.barcode,source.lot&&'Lot: '+source.lot,source.location].filter(Boolean).join(' · ');controls=[ui.selector,ui.exportOne,ui.exportAll];
  for(const field of prepared.fields){const rowNode=node('label','labsafe-field'),caption=node('span','',field.label+(field.required?' *':'')),input=node('input'),copy=button('Copy',()=>copyField(field.key)),detail=node('small','',field.needsCheck?field.reason:!field.value?'Not recorded.':'');detail.hidden=!detail.textContent;input.value=field.value;input.setAttribute('aria-label',field.label);input.maxLength=10000;copy.setAttribute('aria-label','Copy '+field.label);input.addEventListener('input',()=>{const value=drafts.get(selection)||{};value[field.key]=input.value;drafts.set(selection,value);detail.hidden=false;detail.textContent='Local draft; not saved to Reagents.';});rowNode.append(caption,input,copy,detail);ui.fields.append(rowNode);controls.push(input,copy);}
  const evidence=node('p','small muted');evidence.textContent=[source.categories&&'Recorded categories: '+source.categories,source.regulatoryList&&'Regulatory source: '+source.regulatoryList,source.toxicClass&&'Explicit toxic class: '+source.toxicClass,source.ghs&&'GHS / SDS: '+source.ghs,source.hazardCodes].filter(Boolean).join(' · ');ui.fields.append(evidence);paintBusy();
 }
 async function open(id=null){
  if(!canPrepareLabSafe(getPermissions()))return false;clear();const available=rows();if(!available.length)throw Error('No current chemical rows match this view.');selection=available.some(row=>row.id===id)?id:available[0].id;context=getContext();dialog=node('dialog','dialog labsafe-preparation');const heading=node('div','section-head'),title=node('h2','','LabSafe preparation'),close=button('×',clear),intro=node('p','labsafe-preparation-notice','Preparation only · Review and submit in LabSafe'),explanation=node('p','small muted','Prepare current recorded stock fields for manual entry. This is not an official import template. Draft edits stay in this dialog; quantities are not converted and no purchase or monthly balances are inferred.'),selector=node('select'),fields=node('div','labsafe-fields'),source=node('p','small'),feedback=node('p','labsafe-feedback'),fallback=node('textarea'),exportOne=button('Download selected draft',()=>exportDraft()),exportAll=button('Download filtered rows',()=>exportDraft(true)),link=node('a','','Open LabSafe ↗'),actions=node('div','actions');
  close.setAttribute('aria-label','Close LabSafe preparation');heading.append(title,close);selector.setAttribute('aria-label','Chemical row');for(const row of available){const option=node('option','',itemName(row)+' · '+(row.payload.barcode||row.id));option.value=row.id;selector.append(option);}selector.value=selection;selector.addEventListener('change',()=>{selection=selector.value;renderFields();});feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');fallback.hidden=true;fallback.readOnly=true;fallback.setAttribute('aria-label','Value for manual copy');link.href=LABSAFE_MANUAL_URL;link.target='_blank';link.rel='noopener noreferrer';actions.append(link,exportOne,exportAll);dialog.append(heading,intro,explanation,selector,source,fields,feedback,fallback,actions);document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();clear();});dialog.showModal();ui={selector,fields,source,feedback,fallback,exportOne,exportAll};controls=[selector,exportOne,exportAll];await authorized(async()=>{renderFields();});return Boolean(dialog);
 }
 return{open,clear,copyField,exportDraft,syncUser(){if(dialog&&!current(generation))clear();},get dialog(){return dialog;},get busy(){return busy;}};
}
