/* Read-only linked portal counts. No global sum or animal-use inference. */
import {listIacucProtocols,protocolsForEntity,taipeiToday} from './iacuc-model.js?v=132';
import {renderIacucPortalUsageCard} from './iacuc-portal-usage-view.js?v=661c6f0-iacuc-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=id=>({action:'iacuc-open-protocol',id});
const overviewLink='<button type="button" class="button secondary" data-action="open-iacuc">Open IACUC</button>';
const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
const exactProtocol=(dataset,value)=>{const rows=listIacucProtocols(dataset).filter(row=>row.event_id===value||row.iacuc_protocol.number===value);return rows.length===1?rows[0]:null;};
const choiceLink=record=>`<button type="button" class="button secondary" data-action="iacuc-open-protocol" data-id="${esc(record.event_id)}">${esc(record.iacuc_protocol.number)}</button>`;

export function renderIacucOverviewUsage(dataset,{canRead=false,day=taipeiToday()}={}){
 if(canRead!==true)return '';
 const protocols=listIacucProtocols(dataset).filter(row=>row.iacuc_protocol.portal_usage_snapshots?.length);
 if(!protocols.length)return `<section class="panel"><div class="panel-body"><h3>IACUC allowance and use</h3><p class="small muted">No reviewed portal-count snapshot is stored yet. Allowance / used / remaining: Unknown.</p>${overviewLink}</div></section>`;
 return `<section aria-label="IACUC allowance and use"><h2>IACUC allowance and use</h2><p class="small muted">Each source period and protocol is separate. These counts are not the current Stock population.</p>${protocols.slice(0,8).map(record=>renderIacucPortalUsageCard(record,{day,compact:true,protocolLink:link(record.event_id)})).join('')}${protocols.length>8?`<p class="small muted">Showing 8 of ${protocols.length} protocols with portal snapshots.</p>${overviewLink}`:''}</section>`;
}

export function renderIacucEntityUsage(dataset,type,id,{canRead=false,day=taipeiToday()}={}){
 if(canRead!==true||!['mice','cages'].includes(type))return '';
 const key=type==='mice'?'mouse_sid':'cage_sid',entity=dataset?.tables?.[type]?.find(row=>String(row[key])===String(id));
 const literal=entity?.protocol||(type==='cages'?entity?.cage_protocol:null),direct=exactProtocol(dataset,literal);
 const assigned=new Set((dataset?.tables?.husbandry_events||[]).filter(row=>row.event_type==='iacuc_assignment'&&!row.app_archived_at&&row.archived!==true&&row.iacuc_assignment?.entity_type===type&&String(row.iacuc_assignment.entity_id)===String(id)&&row.iacuc_assignment.evidence_status==='confirmed'&&validDay(row.iacuc_assignment.valid_from)&&row.iacuc_assignment.valid_from<=day&&(!row.iacuc_assignment.valid_to||validDay(row.iacuc_assignment.valid_to)&&day<=row.iacuc_assignment.valid_to)).map(row=>row.iacuc_assignment.protocol_id));
 const rows=protocolsForEntity(dataset,type,id,{day}).filter(row=>row.event_id===direct?.event_id||assigned.has(row.event_id));
 if(rows.length>1)return `<section class="panel"><div class="panel-body"><h3>IACUC allowance and use</h3><p class="small muted">Multiple protocol associations; the applicable allowance balance is unknown. Choose the intended protocol in IACUC.</p>${rows.map(choiceLink).join('')}</div></section>`;
 if(!rows.length&&literal)return `<p class="small muted">The recorded protocol is not uniquely resolved by exact number or ID. Its allowance balance is unknown. ${overviewLink}</p>`;
 return rows.map(record=>renderIacucPortalUsageCard(record,{day,compact:true,protocolLink:link(record.event_id)})).join('');
}

export function renderIacucExperimentUsage(dataset,record,{canRead=false}={}){
 if(canRead!==true)return '';
 const payload=record?.experiment||record?.experiment_sample,protocol=exactProtocol(dataset,payload?.protocol);
 if(!payload?.protocol)return '';
 if(!protocol)return `<p class="small muted">The IACUC protocol is not uniquely resolved. Its allowance balance is unknown. ${overviewLink}</p>`;
 const day=record.event_date||payload.collection_at?.slice(0,10)||payload.started_at?.slice(0,10);
 if(!validDay(day))return `<section class="panel"><div class="panel-body"><h3>IACUC · ${esc(protocol.iacuc_protocol.number)}</h3><p class="small muted">Event date not recorded; the applicable allowance period is unknown.</p>${overviewLink}</div></section>`;
 return `<p class="small muted">Latest stored source totals; event date ${esc(day)} provides context for choosing an allowance period. These are not historical balances.</p>${renderIacucPortalUsageCard(protocol,{day,compact:true,protocolLink:link(protocol.event_id)})}`;
}
