import test from 'node:test';
import assert from 'node:assert/strict';
import {showInRecentOrders,readOrderDisplayPage,RECENT_RECEIVED_DAYS,ORDER_STATUS_GROUPS,createOrdersUI} from '../reagents/orders.js';

const DAY='2026-11-03',FID='11111111-1111-4111-8111-111111111111';
const received=(id='receipt',date='2026-09-28')=>({id,status:'received',name:id,acceptance_date:date,created_at:'2026-11-02T00:00:00Z',updated_at:'2026-11-03T00:00:00Z',inventory_id:'app-receipt:'+FID,arrival_plan:{state:'received',reasons:[],fulfillmentId:FID,destination:'inventory'},allowed_actions:[]});
const fetcher=(rows,calls=[])=>async args=>{calls.push({...args});const selected=args.p_status?rows.filter(r=>r.status===args.p_status):rows,part=selected.slice(args.p_offset,args.p_offset+args.p_limit);return{rows:part,total:selected.length,next_offset:args.p_offset+part.length<selected.length?args.p_offset+part.length:null};};

test('completed PCR receipt leaves Recent Orders by actual arrival, never its November adoption/update date',()=>{
 const row=received('BL7115'),before=structuredClone(row);assert.equal(showInRecentOrders(row,DAY),false);assert.deepEqual(row,before);
 assert.equal(showInRecentOrders({...row,acceptance_date:'2026-11-03',created_at:'2020-01-01'},DAY),true);
});
test('30 calendar days are retained; day31 moves to history, including the Taipei midnight boundary',()=>{
 assert.equal(RECENT_RECEIVED_DAYS,30);for(const date of ['2026-11-03','2026-10-04'])assert.equal(showInRecentOrders(received('x',date),DAY),true);assert.equal(showInRecentOrders(received('x','2026-10-03'),DAY),false);
 const RealDate=globalThis.Date;try{globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-02T16:30:00Z']));}};assert.equal(showInRecentOrders(received('x','2026-10-03')),false);}finally{globalThis.Date=RealDate;}
});
test('all non-received statuses remain regardless of age, including declined and cancelled',()=>{
 for(const status of ['submitted','approved','ordered','rejected','cancelled','arrived','unknown'])assert.equal(showInRecentOrders({...received(),status},DAY),true,status);
});
test('unknown, invalid, future or unresolved deliveries stay visible rather than silently filed',()=>{
 for(const acceptance_date of [null,undefined,'','Unknown','2026-02-30','2026-09-28T00:00:00Z','2026-11-04'])assert.equal(showInRecentOrders({...received(),acceptance_date},DAY),true,String(acceptance_date));
 for(const patch of [{inventory_id:null,arrival_plan:null},{arrival_plan:{state:'queued',reasons:[],fulfillmentId:FID}},{arrival_plan:{state:'review',reasons:['partial_delivery_needs_review']}},{arrival_plan:{state:'received',reasons:['source_details_changed'],fulfillmentId:FID}}])assert.equal(showInRecentOrders({...received(),...patch},DAY),true);
 assert.equal(showInRecentOrders({...received(),inventory_id:null,arrival_plan:{state:'received',reasons:[],fulfillmentId:FID,destination:'primers'}},DAY),false);
 for(const destination of [undefined,null,'review','unknown','inventory'])assert.equal(showInRecentOrders({...received(),inventory_id:null,arrival_plan:{state:'received',reasons:[],fulfillmentId:FID,destination}},DAY),true,'unresolved destination '+destination);
 assert.equal(showInRecentOrders({...received(),inventory_id:null,arrival_plan:{state:'received',reasons:[],fulfillmentId:FID,destination:'mouse-iacuc'}},DAY),false);
 assert.equal(showInRecentOrders({...received(),arrival_plan:null},DAY),false,'legacy completed Inventory receipt');
});
test('unfinished requests beyond several all-old pages are found without changing or replaying source rows',async()=>{
 const rows=[...Array.from({length:75},(_,i)=>received('old'+i)),...Array.from({length:32},(_,i)=>({id:'pending'+i,status:'ordered'}))],calls=[],before=structuredClone(rows);
 const first=await readOrderDisplayPage({fetchPage:fetcher(rows,calls),asOf:DAY});assert.equal(first.rows.length,30);assert.equal(first.rows[0].id,'pending0');assert.deepEqual(first.next_offset,{group:2,offset:30});assert.deepEqual(calls.map(x=>x.p_status),['submitted','approved','ordered']);
 const next=await readOrderDisplayPage({fetchPage:fetcher(rows),asOf:DAY,offset:first.next_offset});assert.deepEqual(next.rows.map(x=>x.id),['pending30','pending31']);assert.equal(next.next_offset,null);assert.deepEqual(rows,before);
});
test('bounded scan exposes a continuation when old history exceeds300 rows',async()=>{
 const rows=[...Array.from({length:305},(_,i)=>received('old'+i)),{...received('unfinished'),arrival_plan:{state:'review',reasons:['mapping_required']}}],calls=[];
 let page=await readOrderDisplayPage({fetchPage:fetcher(rows,calls),asOf:DAY});assert.equal(calls.length,10);assert.equal(page.rows.length,0);assert.equal(page.scanLimited,true);assert.deepEqual(page.next_offset,{group:3,offset:210});
 const found=[];for(let n=0;page.next_offset!==null&&n<10;n++){const reads=[];page=await readOrderDisplayPage({fetchPage:fetcher(rows,reads),offset:page.next_offset,asOf:DAY});assert(reads.length<=10);found.push(...page.rows);}
 assert.deepEqual(found.map(r=>r.id),['unfinished']);assert.equal(page.next_offset,null);
});
test('explicit Received retrieves all ages with exact receipt/Inventory links intact',async()=>{
 const row=received(),calls=[];const result=await readOrderDisplayPage({fetchPage:fetcher([row],calls),status:'received',asOf:DAY});assert.deepEqual(result.rows,[row]);assert.equal(calls.length,1);assert.equal(calls[0].p_status,'received');
});
test('changed account/view cancels scanning and malformed/nonadvancing pagination fails',async()=>{
 let current=true,calls=0;assert.equal(await readOrderDisplayPage({isCurrent:()=>current,fetchPage:async()=>{calls++;current=false;return{rows:[received()],total:1,next_offset:null};}}),null);assert.equal(calls,1);
 for(const result of [{rows:[],total:1,next_offset:0},{rows:[received()],total:1,next_offset:0},{rows:[received(),received()],total:2,next_offset:null}])await assert.rejects(readOrderDisplayPage({fetchPage:async()=>result,asOf:DAY}),/Refresh requests/);
});

function ui(rows){
 const elements=new Map(),calls=[],listeners=new Map();let catalogue=0;
 const el=id=>{if(!elements.has(id)){const x={id,innerHTML:'',textContent:'',value:'',listeners:new Map(),addEventListener(k,v){this.listeners.set(k,v);},removeEventListener(){},querySelector(){return{disabled:false};},elements:{query:{addEventListener(){}}}};elements.set(id,x);}return elements.get(id);};
 const main=el('main');main.addEventListener=(k,v)=>listeners.set(k,v);main.removeEventListener=k=>listeners.delete(k);
 const controller=createOrdersUI({main,document:{getElementById:el},getPermissions:()=>({role:'owner',can_write:false,can_order:false}),isCurrent:()=>true,uuid:()=>FID,rpc:async(action,args)=>{assert.equal(action,'app_order_list');return fetcher(rows,calls)(args);},openHistory:()=>{catalogue++;}});
 const click=action=>listeners.get('click')({target:{closest:()=>({dataset:{orderAction:action},disabled:false})}});
 return{controller,el,calls,click,catalogue:()=>catalogue};
}
test('actual Recent Orders rendering hides old card; Historical orders uses received RPC and keeps its Inventory link',async t=>{
 const f=ui([received('PCR-old'),{id:'awaiting',status:'ordered',name:'Pending delivery',allowed_actions:[]}]);t.after(()=>f.controller.dispose());await f.controller.mount();
 assert.doesNotMatch(f.el('purchase-list').innerHTML,/PCR-old/);assert.match(f.el('purchase-list').innerHTML,/Pending delivery/);assert.match(f.el('main').innerHTML,/Recent Orders/);
 await f.click('history');assert.equal(f.calls.at(-1).p_status,'received');assert.equal(f.el('purchase-list-heading').textContent,'Historical orders');assert.match(f.el('purchase-list').innerHTML,/PCR-old/);assert.match(f.el('purchase-list').innerHTML,/#inventory\/app-receipt%3A/);assert.equal(f.catalogue(),0);
 await f.click('catalog-history');assert.equal(f.catalogue(),1);
});
test('UI Previous/Next use scanned cursors without skipping unfinished requests',async t=>{
 const f=ui([...Array.from({length:40},(_,i)=>received('old'+i)),...Array.from({length:32},(_,i)=>({id:'pending'+i,status:'ordered',name:'Pending '+i,allowed_actions:[]}))]);t.after(()=>f.controller.dispose());await f.controller.mount();assert.match(f.el('purchase-list').innerHTML,/Pending 0</);assert.match(f.el('purchase-pages').innerHTML,/Page 1/);
 await f.click('list-next');assert.match(f.el('purchase-list').innerHTML,/Pending 30</);assert.doesNotMatch(f.el('purchase-list').innerHTML,/Pending 0</);assert.match(f.el('purchase-pages').innerHTML,/Page 2/);
 await f.click('list-prev');assert.match(f.el('purchase-list').innerHTML,/Pending 0</);assert.match(f.el('purchase-pages').innerHTML,/Page 1/);
});

test('All groups statuses globally across pages and preserves server recency within every group',async()=>{
 assert.deepEqual(ORDER_STATUS_GROUPS,['submitted','approved','ordered','received','rejected','cancelled']);
 const rows=ORDER_STATUS_GROUPS.flatMap((status,g)=>Array.from({length:35},(_,i)=>({...received(status+'-'+i,'2026-11-01'),status,created_at:`2026-11-${String(1+i%3).padStart(2,'0')}T${String(g).padStart(2,'0')}:00:00Z`})));
 rows.push({...received('unknown-future','2026-11-01'),status:'needs_vendor_review',created_at:'2026-11-03T23:00:00Z'});
 rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
 const displayed=[],cursors=[],calls=[];let offset=0;
 for(let n=0;n<30;n++){const perPage=[];const result=await readOrderDisplayPage({fetchPage:fetcher(rows,perPage),offset,asOf:DAY});assert(perPage.length<=10);calls.push(...perPage);displayed.push(...result.rows);if(result.next_offset===null)break;cursors.push(result.next_offset);offset=result.next_offset;}
 assert.equal(displayed.length,211);assert.equal(new Set(displayed.map(r=>r.id)).size,211);
 assert.deepEqual(displayed.map(r=>r.status),[...ORDER_STATUS_GROUPS.flatMap(s=>Array(35).fill(s)),'needs_vendor_review']);
 for(const status of ORDER_STATUS_GROUPS)assert.deepEqual(displayed.filter(r=>r.status===status).map(r=>r.id),rows.filter(r=>r.status===status).map(r=>r.id));
 assert(cursors.some(c=>c.group===1&&c.offset>0),'group boundary continues in the next page, not local sorting');
 assert(calls.some(c=>c.p_status===''),'unknown statuses have an explicit read-only review scan');
});

test('old received history cannot hide earlier status groups or later cancelled and unknown rows',async()=>{
 const rows=[...Array.from({length:650},(_,i)=>received('old'+i)),{id:'awaiting',status:'submitted'},{id:'cancelled-old',status:'cancelled'},
  {id:'unrecognized',status:'future_status'}],seen=[];let offset=0,first;
 for(let n=0;n<20;n++){const calls=[];const result=await readOrderDisplayPage({fetchPage:fetcher(rows,calls),offset,asOf:DAY});assert(calls.length<=10);first??=result;seen.push(...result.rows);if(result.next_offset===null){offset=null;break;}offset=result.next_offset;}
 assert.equal(first.rows[0].id,'awaiting');assert.deepEqual(seen.map(r=>r.id),['awaiting','cancelled-old','unrecognized']);assert.equal(offset,null);
});

test('composite cursor and status-filtered response schemas fail closed',async()=>{
 for(const offset of [30,{group:-1,offset:0},{group:7,offset:0},{group:0,offset:-1},{group:0,offset:0,extra:true}])await assert.rejects(readOrderDisplayPage({offset,fetchPage:fetcher([])}),/valid order page/);
 await assert.rejects(readOrderDisplayPage({status:'received',offset:{group:3,offset:0},fetchPage:fetcher([])}),/valid order page/);
 await assert.rejects(readOrderDisplayPage({fetchPage:async()=>({rows:[{id:'wrong',status:'approved'}],total:1,next_offset:null})}),/Refresh requests/);
});

test('All label is literal and dropdown status order matches global group order',async t=>{
 const f=ui([]);t.after(()=>f.controller.dispose());await f.controller.mount();
 assert.match(f.el('main').innerHTML,/<option value="">All<\/option>/);
 const options=[...f.el('main').innerHTML.matchAll(/<option value="([a-z]*)">/g)].map(m=>m[1]);assert.deepEqual(options,['',...ORDER_STATUS_GROUPS]);
});
