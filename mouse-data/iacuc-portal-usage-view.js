/* Plain, escaped presentation of separately scoped portal snapshots. */
import {getIacucPortalUsage} from './iacuc-portal-usage.js?v=661c6f0-iacuc-1';
import {protocolDateStatus} from './iacuc-model.js?v=132';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isInteger(value)?new Intl.NumberFormat('en-US').format(value):'Unknown';
const label=period=>period?.label||'Period unspecified';
const scope=period=>period?.scopeLabel||'Allowance scope unspecified';
const safeURL=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};

export function iacucPortalObservedHTML(value){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return 'Unknown';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  return `<time datetime="${esc(value)}" title="${esc(value)}">${esc(parts.year+'-'+parts.month+'-'+parts.day+' '+parts.hour+':'+parts.minute+' Taipei')}</time>`;
}
export function iacucPortalPeriodLabel(period){return `${label(period)} · ${scope(period)}`;}
export function iacucPortalRemainingText(period){
  if(!period)return 'Unknown';
  if(period.remainingKind==='allocation_sum'&&Number.isInteger(period.remainingDisplay))return period.remainingDisplay<0?'Over by '+number(-period.remainingDisplay):number(period.remainingDisplay);
  if(period.sameScope!==true)return Number.isInteger(period.remaining)?'Unknown balance · source remaining '+(period.remaining<0?'Over by '+number(-period.remaining):number(period.remaining)):'Unknown';
  if(Number.isInteger(period.remaining))return period.remaining<0?'Over by '+number(-period.remaining):number(period.remaining);
  if(Number.isInteger(period.calculatedAvailable))return period.calculatedAvailable<0?'Over by '+number(-period.calculatedAvailable):number(period.calculatedAvailable);
  if(Number.isInteger(period.calculatedNotYetUsed))return period.calculatedNotYetUsed<0?'Over by '+number(-period.calculatedNotYetUsed):number(period.calculatedNotYetUsed);
  return 'Unknown';
}
export function iacucPortalRemainingLabel(period){
  if(period?.remainingKind==='allocation_sum')return 'Sum of portal allocation balances';
  if(Number.isInteger(period?.remaining))return 'Portal remaining';
  if(Number.isInteger(period?.calculatedAvailable))return 'Calculated available';
  if(Number.isInteger(period?.calculatedNotYetUsed))return 'Calculated not yet used';
  return 'Remaining';
}
export function iacucPortalUsedText(period){return !period||period.usedComplete!==true?'Unknown'+(Number.isInteger(period?.used)?' (partial source: '+number(period.used)+')':''):number(period.used);}
export function iacucPortalStatusText(record,usage,day){
  const protocolStatus=protocolDateStatus(record,day),period=usage?.selected,parts=[];
  if(protocolStatus!=='active')parts.push('Protocol '+protocolStatus);
  if(period?.periodStatus==='expired')parts.push('Allowance period expired');
  if(period?.periodStatus==='future')parts.push('Allowance period has not started');
  if(period?.stale===true||usage?.status==='stale')parts.push('Stale source');
  if(!period)parts.push(usage?.periods?.length?'Choose an explicit allowance period':'No scoped portal counts');
  if(period&&(period.kind==='unknown'||period.datesKnown!==true))parts.push('Allowance period unspecified · Current period association unknown');
  else if(usage?.displayOnlySelection)parts.push('Shown source period · Current period association unknown');
  if(period&&period.sameScope!==true)parts.push('Scope comparison unknown');
  if(period&&period.usedComplete!==true)parts.push('Used total incomplete or unknown');
  return parts.join(' · ')||'Source-reported counts';
}
export function iacucPortalCountsHTML(record,usage,{day,compact=false}={}){
  const period=usage?.selected,status=iacucPortalStatusText(record,usage,day);
  if(!period)return `<p class="small muted">${esc(status)}. Allowance / used / remaining: Unknown.</p>`;
  const summed=period.countBasis==='complete_allocation_sum';
  const counts=[[summed?'Sum of allocation allowances':'Approved allowance',number(period.allowance)],[summed?'Sum of allocation used counts':'Portal reported used',iacucPortalUsedText(period)],[summed?'Sum of allocation pending counts':'Pending / reserved',number(period.pending)],[iacucPortalRemainingLabel(period),iacucPortalRemainingText(period)]];
  return `<p><strong>${esc(label(period))}</strong> · ${esc(scope(period))}${period.grantId?' · Grant / award: '+esc(period.grantId):''}</p>${summed?'<p class="small muted">Calculated from the complete, nonoverlapping source allocation tabs. The portal did not report one overall row. These source used counts do not identify unique mouse SIDs.</p>':''}<div class="exp-stats">${counts.map(([name,value])=>`<article><span>${esc(name)}</span><strong>${esc(value)}</strong></article>`).join('')}</div><p class="small muted">${esc(status)}${period.startDate||period.endDate?' · '+esc(period.startDate||'Start unspecified')+' – '+esc(period.endDate||'End unspecified'):''}. ${period.remaining==null&&period.calculatedNotYetUsed!=null&&period.calculatedAvailable==null?'Not yet used does not establish availability after reservations. ':''}${period.pending==null?'Reservations unknown. ':''}${period.kind==='unknown'?'No financial-year or grant boundary is inferred.':''}</p>${period.overBy>0?`<p class="alert error">Source usage exceeds allowance: over by ${esc(number(period.overBy))}.</p>`:''}${period.remaining!=null&&period.calculatedAvailable!=null&&period.remaining!==period.calculatedAvailable?`<p class="small muted">Supported calculation after explicit disjoint reservations: ${esc(period.calculatedAvailable<0?'Over by '+number(-period.calculatedAvailable):number(period.calculatedAvailable))}. The portal remaining figure is retained independently.</p>`:''}<p class="small muted">Source as of: ${esc(period.asOfDate||'Unspecified')} · Observed: ${iacucPortalObservedHTML(period.observedAt||usage.latestObservedAt)}</p>`;
}
export function iacucPortalAllocationsHTML(period){
  const rows=Array.isArray(period?.allocations)?period.allocations:[];if(!rows.length)return '';
  return `<details class="compact-details"><summary>Source allocation tabs · ${rows.length} separate row(s)</summary><p class="small muted">Tab ordinals and literal labels distinguish allocations even when their labels match.${period.countBasis==='complete_allocation_sum'?' The totals above are calculated across this complete, nonoverlapping partition.':' These rows are retained as source detail and are not added to any reported overall total.'} Missing genotype and location evidence stays unspecified.</p><div class="table-scroll"><table><thead><tr><th>Tab</th><th>Exact source label</th><th>Allowance</th><th>Used</th><th>Pending</th><th>Portal balance</th><th>Explicit genotype</th><th>Explicit room</th><th>Explicit facility</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.ordinal)}</td><td>${esc(row.label)}</td><td>${esc(number(row.allowance))}</td><td>${esc(number(row.used))}</td><td>${esc(number(row.pending))}</td><td>${esc(Number.isInteger(row.remaining)&&row.remaining<0?'Over by '+number(-row.remaining):number(row.remaining))}</td><td>${esc(row.genotype_label||'Unspecified')}</td><td>${esc(row.room_label||'Unspecified')}</td><td>${esc(row.facility_label||'Unspecified')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
export function iacucPortalBreakdownsHTML(period){
  if(!period)return '';
  const rows=Array.isArray(period.breakdowns)?period.breakdowns:[];
  if(!rows.length)return '<p class="small muted">Genotype / strain and room / SPF breakdowns are unspecified. The source counts are retained.</p>';
  return `<details class="compact-details"><summary>Source-evidenced breakdowns · separate views</summary><p class="small muted">Labels below are retained as reported. Genotype, strain and room views may overlap; do not add them together. A reported strain does not establish a genotype.</p><div class="table-scroll"><table><thead><tr><th>Source axis</th><th>Exact source label</th><th>Used</th><th>Allowance</th><th>Pending</th><th>Remaining</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.axis)}</td><td>${esc(row.label)}</td><td>${esc(number(row.used))}</td><td>${esc(number(row.allowance))}</td><td>${esc(number(row.pending))}</td><td>${esc(number(row.remaining))}</td></tr>`).join('')}</tbody></table></div></details>`;
}
export function iacucPortalHistoryHTML(record){
  const history=record?.iacuc_protocol?.portal_usage_snapshots;if(!Array.isArray(history)||!history.length)return '';
  return `<details class="compact-details"><summary>Portal count history · ${history.length} snapshot(s)</summary><p class="small muted">Cumulative totals are snapshots and are not added together. Source corrections retain earlier values.${history.length>20?' The latest 20 snapshots are shown; older snapshots remain stored.':''}</p>${history.slice(-20).reverse().map(snapshot=>`<details class="compact-details"><summary>Observed ${iacucPortalObservedHTML(snapshot.observed_at)} · source as of ${esc(snapshot.as_of_date||'unspecified')}</summary>${(Array.isArray(snapshot.periods)?snapshot.periods:[]).map(period=>`<p>${esc(period.period_label)} · ${esc(period.scope_label)} · ${period.count_basis==='complete_allocation_sum'?'calculated all-tab sums: ':'source figures: '}allowance ${esc(number(period.allowance))} · used ${esc(number(period.used))}${period.used_complete===true?'':' (incomplete or unknown)'} · pending ${esc(number(period.pending))} · ${period.count_basis==='complete_allocation_sum'?'sum of allocation balances':'source remaining'} ${esc(Number.isInteger(period.remaining)&&period.remaining<0?'Over by '+number(-period.remaining):number(period.remaining))}</p>${iacucPortalAllocationsHTML({...period,countBasis:period.count_basis})}`).join('')}</details>`).join('')}</details>`;
}
export function renderIacucPortalUsageCard(record,{day,periodId=null,compact=false,protocolLink=null,localUsed=null}={}){
  const usage=getIacucPortalUsage(record,{periodId,day}),period=usage.selected;
  let link='';
  if(protocolLink&&typeof protocolLink==='object'&&/^[a-z][a-z0-9-]*$/i.test(protocolLink.action||''))link=`<button type="button" class="button secondary" data-action="${esc(protocolLink.action)}" data-id="${esc(protocolLink.id||record?.event_id)}">Open IACUC</button>`;
  else if(typeof protocolLink==='string'&&(protocolLink.startsWith('#')||safeURL(protocolLink)))link=`<a href="${esc(protocolLink.startsWith('#')?protocolLink:safeURL(protocolLink))}">Open IACUC</a>`;
  const url=safeURL(period?.sourceURL);
  return `<section class="panel iacuc-portal-usage"><div class="panel-body"><h3>IACUC · ${esc(record?.iacuc_protocol?.number||'Protocol')}</h3>${iacucPortalCountsHTML(record,usage,{day,compact})}${Number.isInteger(localUsed)?`<p class="small muted">Locally confirmed unique-mouse use: ${esc(number(localUsed))}. Dated local evidence has separate coverage and is not added to the portal counts.</p>`:''}${compact?'':iacucPortalAllocationsHTML(period)+iacucPortalBreakdownsHTML(period)}${usage.warnings?.length?`<p class="small muted">${usage.warnings.map(esc).join(' · ')}</p>`:''}${url&&!compact?`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Source portal</a></p>`:''}${link}</div></section>`;
}
