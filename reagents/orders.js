import {esc,text,validDate,numeric} from './model.js?v=4';

export const ORDER_STATES=Object.freeze({submitted:'Awaiting approval',approved:'Proceed to purchase',ordered:'Awaiting receipt',received:'Received',rejected:'Declined',cancelled:'Cancelled'});
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
const bounded=(value,label,max=200)=>{const s=text(value).trim();if(s.length>max)throw Error(`${label} is too long.`);return s;};
export function validatePurchase(values){
 const p={name:bounded(values.name,'Item name',500),catalog_number:bounded(values.catalog_number,'Item number'),vendor:bounded(values.vendor,'Vendor',300),brand:bounded(values.brand,'Brand'),vendor_email:bounded(values.vendor_email,'Vendor email',320),currency:bounded(values.currency??'TWD','Currency',3).toUpperCase(),pack_size:bounded(values.pack_size,'Pack size'),note:bounded(values.note,'Notes',4000)};
 if(!p.name||!p.catalog_number||!p.vendor)throw Error('Enter item name, item number and vendor.');
 p.price=numeric(values.price,'Price',{optional:false});p.quantity=numeric(values.quantity??1,'Quantity',{optional:false,min:Number.MIN_VALUE});
 if(p.price>1e9||p.quantity>1e6||p.price*p.quantity>1e12)throw Error('Price, quantity or total exceeds the purchase limit.');
 if(!/^[A-Z]{3}$/.test(p.currency))throw Error('Enter a three-letter currency code.');
 if(p.vendor_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.vendor_email))throw Error('Enter a valid vendor email, or leave it blank.');
 if(values.offer_id)p.offer_id=bounded(values.offer_id,'Historical offer',200);
 return p;
}
export function purchaseReady(values){try{validatePurchase(values);return true;}catch{return false;}}
export function validateReceipt(values,locations,asOf=today()){
 if(!validDate(values.acceptance_date)||values.acceptance_date>asOf)throw Error('Choose an acceptance date no later than today.');
 const storage_location=text(values.storage_location).trim();if(!storage_location||!locations.includes(storage_location))throw Error('Choose a storage position from the list.');
 return {acceptance_date:values.acceptance_date,storage_location};
}
export function offerDetails(offer){
 return {name:text(offer.name),catalog_number:text(offer.catalog_number),brand:text(offer.brand),vendor:text(offer.vendor),vendor_email:text(offer.vendor_email),price:offer.price_basis==='unit'&&/^[A-Z]{3}$/.test(text(offer.currency))&&typeof offer.price==='number'&&Number.isFinite(offer.price)?String(offer.price):'',currency:text(offer.currency||''),quantity:'1',pack_size:'',note:'',offer_id:offer.offer_id};
}
export function allowedOrderActions(row,role){
 const allowed=new Set(Array.isArray(row.allowed_actions)?row.allowed_actions:[]);
 const owner=role==='owner',own=row.is_requester===true;
 return [...allowed].filter(a=>['approve','reject'].includes(a)?owner:['ordered','receive','cancel'].includes(a)&&(owner||own));
}
export function notificationText(notifications=[]){
 return notifications.map(n=>{const name=n.event==='submitted'?'Approval email':n.event==='approved'?'Purchase email':n.event==='rejected'?'Decision email':['received','receipt_reminder'].includes(n.event)?'Receipt email':'Email';return `${name} ${({queued:'queued',pending:'queued',leased:'pending delivery',cancelled:'cancelled',sending:'pending delivery',sent:'sent',failed:'failed',provider_unconfigured:'not configured',uncertain:'delivery unconfirmed',retrying:'awaiting retry',suppressed:'not sent'})[n.status]||'status unknown'}`;}).join(' · ');
}
const price=p=>typeof p.price==='number'&&Number.isFinite(p.price)?`${text(p.currency||'Currency unknown')} ${p.price.toLocaleString(undefined,{maximumFractionDigits:4})}`:text(p.price_text||'Price not recorded');
const date=value=>value?text(value).slice(0,10):'Date unknown';
const input=(key,label,value='',{type='text',required=false,wide=false,maxLength=200}={})=>`<label class="field ${wide?'wide':''}">${esc(label)}${type==='textarea'?`<textarea name="${key}" maxlength="${maxLength}">${esc(value)}</textarea>`:`<input name="${key}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'step="any" min="0"':`maxlength="${maxLength}"`}>`}</label>`;
const options=(locations,current='')=>'<option value="">Choose storage position</option>'+locations.map(s=>`<option value="${esc(s)}" ${s===current?'selected':''}>${esc(s)}</option>`).join('');

// Each mount is tied to the verified account and route. No private drafts or
// catalogue results are persisted in localStorage or the offline cache.
export function createOrdersUI({main,rpc,getPermissions,isCurrent,notify=()=>{},openHistory=()=>{},refreshInventory=async()=>{},document:doc=globalThis.document,FormData:FormDataAPI=globalThis.FormData,uuid=()=>crypto.randomUUID()}){
 let alive=true,searchGeneration=0,listGeneration=0,searchTimer=null,searchQuery='',searchOffset=0,requestOffset=0,requestStatus='',offers=[],orders=[],locations=[],requestID=uuid(),submission=null,submitting=false;
 const $=id=>doc.getElementById(id),active=()=>alive&&isCurrent(),check=()=>{if(!active())throw Error('Your session or page changed. Reopen Orders.');},permissions=()=>getPermissions();
 const call=async(action,args={})=>{check();const result=await rpc(action,args);check();return result;};
 const manager=()=>['owner','manager'].includes(permissions().role);
 const canOrder=()=>permissions().can_order===true||permissions().can_request_purchase===true;
 const formValues=()=>Object.fromEntries(new FormDataAPI($('purchase-form')));
 function formHTML(v={}){return `<form id="purchase-form" class="order-form"><div class="order-fields">${input('name','Item name *',v.name,{required:true,wide:true,maxLength:500})}${input('catalog_number','Item / catalogue number *',v.catalog_number,{required:true})}${input('brand','Brand',v.brand)}${input('price','Unit price *',v.price,{type:'number',required:true})}${input('currency','Currency',v.currency??'TWD',{required:true,maxLength:3})}${input('quantity','Quantity',v.quantity||'1',{type:'number',required:true})}${input('pack_size','Pack size / unit',v.pack_size)}${input('vendor','Vendor *',v.vendor,{required:true})}${input('vendor_email','Vendor contact email',v.vendor_email,{type:'email',maxLength:320})}${input('note','Purpose / quote details',v.note,{type:'textarea',wide:true,maxLength:4000})}</div><input type="hidden" name="offer_id" value="${esc(v.offer_id||'')}"><div class="order-submit"><span class="small muted"><span id="purchase-requirements">* Required for purchase approval</span><strong id="purchase-total" class="secondary-line"></strong></span><button id="purchase-submit" class="primary" disabled>Apply for purchase</button></div><p id="purchase-error" class="error" role="alert"></p></form>`;}
 function bindForm(){const f=$('purchase-form');if(!f)return;const update=()=>{if(!active())return;const values=formValues();$('purchase-submit').disabled=submitting||!canOrder()||!purchaseReady(values);$('purchase-total').textContent=purchaseReady(values)?`Total: ${text(values.currency).toUpperCase()} ${(Number(values.price)*Number(values.quantity)).toLocaleString(undefined,{maximumFractionDigits:4})}`:'';};f.addEventListener('input',update);f.addEventListener('submit',submit);update();}
 function setDraft(values={}){$('purchase-form-wrap').innerHTML=formHTML(values);bindForm();}
 function freezeForm(value){for(const c of $('purchase-form').elements)c.disabled=value;$('purchase-submit').disabled=value||!purchaseReady(formValues());}
 async function submit(e){
  e.preventDefault();if(submitting||!active()||!canOrder())return;
  let details;try{details=submission||validatePurchase(formValues());}catch(error){$('purchase-error').textContent=error.message;return;}
  if(submission&&JSON.stringify(details)!==JSON.stringify(submission)){$('purchase-error').textContent='Confirm the previous request first using Retry. It may already be saved.';return;}
  submission=details;submitting=true;$('purchase-error').textContent='';freezeForm(true);
  try{const response=await call('order_submit',{p_id:requestID,p_details:submission});const row=response.request||response;requestID=uuid();submission=null;setDraft();notify(`Purchase request saved. ${notificationText(row.notifications)||'Email delivery status will appear with the request.'}`);await loadRequests();}
  catch(error){if(active()){$('purchase-error').textContent=`${error.message} Your request ID is retained. Retry to confirm this request without duplicating it.`;for(const c of $('purchase-form').elements)c.disabled=true;$('purchase-submit').disabled=false;$('purchase-submit').textContent='Retry purchase request';}}
  finally{submitting=false;if(active()&&!submission)$('purchase-submit').disabled=!canOrder()||!purchaseReady(formValues());}
 }
 async function search(start=0){
  const version=++searchGeneration;searchOffset=start;$('order-search-status').textContent='Searching order history…';
  try{const result=await call('order_search',{p_query:searchQuery,p_offset:start,p_limit:20});if(version!==searchGeneration)return;offers=result.rows||[];
   $('order-search-status').textContent=offers.length?`${result.total.toLocaleString()} historical options. Confirm the price and vendor before applying.`:'No historical match. Enter a new item below.';
   $('order-offers').innerHTML=offers.map((p,i)=>`<article class="order-offer"><div><h3>${esc(p.name)}</h3><p>${esc([p.catalog_number,p.brand].filter(Boolean).join(' · '))}</p><p><strong>${esc(price(p))}</strong> <span class="muted">${p.price_basis==='unit'?'per unit':p.price_basis==='subtotal'?'recorded subtotal':'basis unspecified'}</span> · ${esc(p.vendor||'Vendor not recorded')}</p>${p.vendor_email?`<p class="offer-email">${esc(p.vendor_email)}</p>`:''}${Array.isArray(p.contact_options)&&p.contact_options.length?`<label class="field">Vendor contact<select data-offer-contact="${i}"><option value="">Choose contact</option>${p.contact_options.map(c=>`<option value="${esc(c.email)}" ${c.email===p.vendor_email?'selected':''}>${esc(c.email)}${c.contact?' · '+esc(c.contact):''} (${c.is_current?'current':esc(date(c.date))})</option>`).join('')}</select></label>`:''}${p.pack_size?`<p class="small muted">Previous quantity / pack: ${esc(p.pack_size)}</p>`:''}<p class="small muted">${esc(date(p.ordered_date))}${p.source_count>1?` · ${p.source_count} source records`:''}</p></div>${canOrder()?`<button type="button" data-order-action="choose" data-index="${i}" ${submission?'disabled':''}>Use these details</button>`:''}</article>`).join('');
   $('order-search-pages').innerHTML=result.total>20?`<button type="button" data-order-action="search-prev" ${start===0?'disabled':''}>← Previous</button><span>${start+1}–${Math.min(start+offers.length,result.total)} of ${result.total}</span><button type="button" data-order-action="search-next" ${result.next_offset===null?'disabled':''}>Next →</button>`:'';
  }catch(error){if(active()&&version===searchGeneration){$('order-search-status').textContent=error.message;$('order-offers').innerHTML='';$('order-search-pages').innerHTML='<button type="button" data-order-action="search-retry">Retry search</button>';}}
 }
 function requestHTML(p){const actions=allowedOrderActions(p,permissions().role),heading=ORDER_STATES[p.status]||p.status;return `<article class="purchase-card" data-order-id="${esc(p.id)}"><div class="section-head"><div><h3>${esc(p.name)}</h3><p class="small muted">${esc([p.catalog_number,p.brand,p.pack_size].filter(Boolean).join(' · '))}</p></div><span class="badge ${p.status==='submitted'?'warn':p.status==='rejected'?'danger':''}">${esc(heading)}</span></div><dl class="purchase-summary"><dt>Unit price</dt><dd>${esc(price(p))}</dd><dt>Quantity</dt><dd>${esc(p.quantity)}</dd><dt>Total</dt><dd>${esc(price({...p,price:Number(p.price)*Number(p.quantity)}))}</dd><dt>Vendor</dt><dd>${esc(p.vendor)}</dd>${p.vendor_email?`<dt>Contact</dt><dd>${esc(p.vendor_email)}</dd>`:''}<dt>Requested</dt><dd>${esc(date(p.created_at))}${manager()&&p.requester_name?' · '+esc(p.requester_name):''}</dd>${p.acceptance_date?`<dt>Accepted</dt><dd>${esc(p.acceptance_date)}</dd><dt>Storage</dt><dd>${esc(p.storage_location)}</dd>`:''}</dl>${p.note?`<p class="notes">${esc(p.note)}</p>`:''}${p.purchase_note?`<p class="notes"><strong>Purchase reference:</strong> ${esc(p.purchase_note)}</p>`:''}${p.decision_note?`<p class="notes"><strong>Decision:</strong> ${esc(p.decision_note)}</p>`:''}<p class="small muted">${esc(notificationText(p.notifications))}</p><div class="order-actions">${actions.includes('approve')?'<button class="primary" data-order-action="approve">Approve</button><button data-order-action="reject">Decline</button>':''}${actions.includes('ordered')?'<button class="primary" data-order-action="purchase">Proceed to purchase</button>':''}${actions.includes('receive')?'<button class="primary" data-order-action="receipt">Record arrival</button>':''}${actions.includes('cancel')?'<button data-order-action="cancel">Cancel request</button>':''}${p.inventory_id?'<a href="#inventory">Open Inventory →</a>':''}</div><div class="order-action-form"></div><p class="order-error error" role="alert"></p></article>`;}
 async function loadRequests(start=requestOffset){
  const version=++listGeneration;requestOffset=start;$('purchase-list-status').textContent='Loading requests…';
  try{const result=await call('order_list',{p_status:requestStatus,p_offset:start,p_limit:30});if(version!==listGeneration)return;orders=result.rows||[];$('purchase-list-status').textContent=`${result.total.toLocaleString()} request${result.total===1?'':'s'}`;$('purchase-list').innerHTML=orders.map(requestHTML).join('')||'<div class="empty">No purchase requests.</div>';
   $('purchase-pages').innerHTML=result.total>30?`<button type="button" data-order-action="list-prev" ${start===0?'disabled':''}>← Previous</button><span>${start+1}–${Math.min(start+orders.length,result.total)} of ${result.total}</span><button type="button" data-order-action="list-next" ${result.next_offset===null?'disabled':''}>Next →</button>`:'';
  }catch(error){if(active()&&version===listGeneration){$('purchase-list-status').textContent=error.message;$('purchase-list').innerHTML='<button type="button" data-order-action="list-refresh">Retry loading requests</button>';}}
 }
 async function loadLocations(){const result=await call('order_locations');locations=Array.isArray(result.locations)?result.locations.filter(x=>typeof x==='string'&&x.trim()):[];}
 function actionForm(card,row,action){
  const slot=card.querySelector('.order-action-form'),err=card.querySelector('.order-error');err.textContent='';
  const titles={approve:'Approve purchase',reject:'Decline request',purchase:'Record purchase',receipt:'Record arrival',cancel:'Cancel request'};
  let content=action==='receipt'?`<label class="field">Acceptance date<input name="acceptance_date" type="date" max="${today()}" value="${today()}" required></label><label class="field">Storage position<select name="storage_location" required>${options(locations)}</select></label>${!locations.length?'<p class="small warning-text">No storage positions available. Ask an owner or manager to add one.</p>':''}`:['approve','reject'].includes(action)?input('decision_note','Decision note','',{type:'textarea',wide:true,maxLength:2000}):action==='purchase'?'<p class="small">Place the order with the vendor, then record it here.</p>'+input('note','Purchase reference / note','',{type:'textarea',wide:true,maxLength:4000}):'<p class="small">Cancel this purchase request?</p>';
  slot.innerHTML=`<form class="purchase-action-form"><h4>${titles[action]}</h4><div class="order-fields">${content}</div><div class="order-actions"><button type="submit" class="primary" ${action==='receipt'&&!locations.length?'disabled':''}>${action==='purchase'?'Mark as ordered':action==='receipt'?'Save receipt':action==='approve'?'Approve':action==='reject'?'Decline':'Confirm cancellation'}</button><button type="button" data-order-action="close-action">Close</button></div></form>`;
  const form=slot.querySelector('form');form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;let details;
   try{details=Object.fromEntries(new FormDataAPI(form));if(action==='receipt')details=validateReceipt(details,locations);const result=await call('order_transition',{p_id:row.id,p_expected_version:row.version,p_action:({purchase:'ordered',receipt:'receive'})[action]||action,p_details:details});const updated=result.request||result;if(action==='receipt')await refreshInventory();notify(action==='receipt'?'Arrival and storage saved to Inventory.':`${ORDER_STATES[updated.status]||'Request updated'}. ${notificationText(updated.notifications)}`);await loadRequests();}
   catch(error){if(active()){err.textContent=`${error.message} Refresh requests to check the saved status before retrying.`;button.disabled=false;}}
  });
 }
 async function click(e){const button=e.target.closest('[data-order-action]');if(!button||button.disabled||!active())return;const action=button.dataset.orderAction;
  try{
   if(action==='choose'){if(submission)return;const chosen=offers[Number(button.dataset.index)],draft=offerDetails(chosen),contact=main.querySelector(`[data-offer-contact="${Number(button.dataset.index)}"]`)?.value;if(contact&&chosen.contact_options?.some(c=>c.email===contact))draft.vendor_email=contact;setDraft(draft);$('purchase-form').elements.name.focus();return;}
   if(action==='search-prev')return search(Math.max(0,searchOffset-20));if(action==='search-next')return search(searchOffset+20);if(action==='search-retry')return search(searchOffset);
   if(action==='list-prev')return loadRequests(Math.max(0,requestOffset-30));if(action==='list-next')return loadRequests(requestOffset+30);if(action==='list-refresh')return loadRequests();if(action==='history')return openHistory();
   if(action==='add-location'){if(!manager())return;$('location-editor').hidden=false;return;}
   if(action==='close-action'){button.closest('.order-action-form').innerHTML='';return;}
   const card=button.closest('[data-order-id]'),row=orders.find(o=>o.id===card?.dataset.orderId);if(!row)return;const required=({purchase:'ordered',receipt:'receive'})[action]||action;if(!allowedOrderActions(row,permissions().role).includes(required))return;
   if(action==='receipt'){button.disabled=true;try{await loadLocations();}finally{if(active())button.disabled=false;}}
   actionForm(card,row,action);
  }catch(error){if(active())notify(error.message,true);}
 }
 async function mount(){
  check();main.innerHTML=`<section class="panel order-search-panel"><div class="section-head"><h2>Find an item</h2><a href="#inventory">Inventory →</a></div><form id="order-search" class="toolbar"><input name="query" type="search" aria-label="Search item name, number or brand" placeholder="Item name, number or brand…" maxlength="200"><button>Search</button></form><p id="order-search-status" class="small muted">Search previous orders for vendor and price options.</p><div id="order-offers" class="order-offers"></div><div id="order-search-pages" class="pagination"></div></section>${canOrder()?'<details class="panel purchase-compose" open><summary>New purchase request</summary><div id="purchase-form-wrap"></div></details>':''}<section class="panel"><div class="section-head"><h2>${manager()?'Purchase requests':'My requests'}</h2><div class="actions"><button data-order-action="list-refresh">Refresh requests</button>${manager()?'<button data-order-action="add-location">Storage positions</button><button data-order-action="history">Historical orders</button>':''}</div></div><form id="location-editor" class="toolbar" hidden><input name="location" required maxlength="300" aria-label="New storage position" placeholder="New storage position"><button>Add position</button><span id="location-status" role="status"></span></form><label class="order-status-filter">Status <select id="purchase-status"><option value="">All</option>${Object.entries(ORDER_STATES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><p id="purchase-list-status" class="small muted"></p><div id="purchase-list" class="purchase-list"></div><div id="purchase-pages" class="pagination"></div></section>`;
  if(canOrder())setDraft();main.addEventListener('click',click);
  $('order-search').addEventListener('submit',e=>{e.preventDefault();clearTimeout(searchTimer);searchQuery=new FormDataAPI(e.currentTarget).get('query').trim();void search();});
  $('order-search').elements.query.addEventListener('input',e=>{clearTimeout(searchTimer);const query=e.target.value.trim();searchGeneration++;searchTimer=setTimeout(()=>{if(active()){searchQuery=query;void search();}},350);});
  $('purchase-status').addEventListener('change',e=>{requestStatus=e.target.value;void loadRequests(0);});
  if(manager())$('location-editor').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('button');if(b.disabled)return;b.disabled=true;try{await call('order_set_location',{p_location:text(new FormDataAPI(form).get('location')).trim(),p_active:true});form.reset();$('location-status').textContent='Storage position saved.';await loadLocations();}catch(error){if(active())$('location-status').textContent=error.message;}finally{if(active())b.disabled=false;}});
  await loadRequests();
 }
 function dispose(){alive=false;searchGeneration++;listGeneration++;clearTimeout(searchTimer);offers=[];orders=[];locations=[];submission=null;main.removeEventListener('click',click);}
 return {mount,dispose,refresh:()=>loadRequests()};
}

export function validateOrderCatalog(bundle){
 if(bundle?.format!=='braintime-reagent-order-catalog-v1'||!Array.isArray(bundle.offers)||!bundle.offers.length)throw Error('Choose a prepared historical order catalogue.');
 const ids=new Set();for(const offer of bundle.offers){if(!offer||typeof offer!=='object'||!text(offer.offer_id)||ids.has(offer.offer_id)||!text(offer.name).trim())throw Error('The catalogue contains missing or duplicate offer IDs.');ids.add(offer.offer_id);}
 return {offers:bundle.offers.length,...bundle.coverage};
}
export async function importOrderCatalog(bundle,{call,check=()=>{},onProgress=()=>{},cryptoAPI=globalThis.crypto}={}){
 validateOrderCatalog(bundle);const report={offers_imported:0,replayed_batches:0,completed_batches:0,total_batches:Math.ceil(bundle.offers.length/100),complete:false};
 try{for(let i=0;i<bundle.offers.length;i+=100){check();const p_offers=bundle.offers.slice(i,i+100),digest=await cryptoAPI.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p_offers))),p_batch_id='reagent-order-catalog-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');check();onProgress(report.completed_batches+1,report.total_batches);const result=await call({p_offers,p_batch_id});check();if(result.replayed)report.replayed_batches++;else report.offers_imported+=Number(result.offers_imported)||0;report.completed_batches++;}report.complete=true;return report;}catch(error){error.importReport=report;throw error;}
}
