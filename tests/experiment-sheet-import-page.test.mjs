import test from 'node:test';
import assert from 'node:assert/strict';

let serial=0;
const clone=structuredClone;
const confirmed=id=>({mouse_sid:id,raw_identifier:id,link_status:'confirmed',candidate_sids:[],role:null,notes:null});
const base=()=>({tables:{mice:[{mouse_sid:'M1',physical_tag:'P1',genotype:'P',state:'Stock'},{mouse_sid:'M2',physical_tag:'B1',genotype:'B',state:'Stock'}],husbandry_events:[],experiment_sources:[{source_id:'SOURCE-1',date:'2024-01-10',assays:['LumiCycle'],raw_identifiers:['P1','Old tag'],tissue:'SCN',storage:'-80 °C',workbook_title:'Experiment Sheet 2024',sheet_name:'LumiCycle',range:'A2:F2',source_url:'https://example.test/sheet',raw_values:{A2:'P1',B2:'<script>raw source</script>'},provenance:[{source_url:'https://example.test/sheet',sheet_name:'LumiCycle',range:'A2:F2',snapshot_date:'2024-06-01'}]}]}});
const decode=s=>String(s??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function fakeContainer(){
  let html='',controls=[];
  const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
  const matches=(c,selector)=>selector.startsWith('#')?c.id===selector.slice(1):selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)?(()=>{const [,k,v]=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return Object.hasOwn(c.attributes,k)&&(v===undefined||c.attributes[k]===v)})():false;
  const form={id:'experiment-form',get controls(){return controls},querySelectorAll:selector=>controls.filter(c=>matches(c,selector))};
  return {get innerHTML(){return html},set innerHTML(value){html=value;controls=[...html.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)].map(m=>{const tag=m[2]||'input',a=attrs(m[1]||m[3]),options=tag==='select'?[...m[4].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(o=>({...attrs(o[1]),selected:/\sselected(?:\s|$)/.test(o[1])})):[];return {attributes:a,id:a.id,name:a.name,type:a.type||'text',tagName:tag.toUpperCase(),value:tag==='select'?(options.find(x=>x.selected)?.value??options[0]?.value??''):tag==='textarea'?decode(m[4]):a.value??'',checked:/\schecked(?:\s|$)/.test(m[1]||''),dataset:Object.fromEntries(Object.entries(a).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),selectionStart:0,focus(){},setSelectionRange(){}}})},querySelector(selector){return selector==='#experiment-form'?(html.includes('id="experiment-form"')?form:null):controls.find(c=>matches(c,selector))??null},querySelectorAll:selector=>controls.filter(c=>matches(c,selector)),get controls(){return controls}};
}
class FakeFormData {
  constructor(form){this.values=form.controls.filter(c=>c.name&&(!(c.type==='checkbox')||c.checked)).map(c=>[c.name,c.value]);}
  has(key){return this.values.some(([name])=>name===key)}get(key){return this.values.find(([name])=>name===key)?.[1]??null}getAll(key){return this.values.filter(([name])=>name===key).map(([,value])=>value)}
}
async function harness(t,dataset=base(),overrides={}) {
  const original=globalThis.FormData;globalThis.FormData=FakeFormData;t.after(()=>{globalThis.FormData=original});
  const {renderExperiments,hasExperimentDrafts,resetExperimentSourceView}=await import(`../mouse-data/experiments.js?test=${++serial}`),container=fakeContainer(),saves=[],messages=[];
  let current=dataset;
  const hooks={canEdit:()=>true,toast:(message,error)=>messages.push({message,error}),openMouse:id=>messages.push({mouse:id}),save:async next=>{current=clone(next);saves.push(current);renderExperiments(container,current,hooks)},...overrides};
  renderExperiments(container,current,hooks);
  return {container,hooks,saves,messages,hasDraft:()=>hasExperimentDrafts(container),resetSources:()=>resetExperimentSourceView(container),get dataset(){return current},
    async click(action,id=''){await container.onclick({preventDefault(){},target:{closest:()=>({dataset:{expAction:action,id}})}})},
    set(name,value){const c=container.querySelector(`[name="${name}"]`);assert(c,`Missing field ${name}`);c.value=value},
    check(name,values){for(const c of container.controls.filter(x=>x.name===name))c.checked=c.type==='checkbox'&&(Array.isArray(values)?values.includes(c.value):values)},
    input(selector,value){const c=container.querySelector(selector);assert(c,`Missing input ${selector}`);c.value=value},
    async save(){await container.onsubmit({preventDefault(){},target:{id:'experiment-form'}})},
    filter(name,value){container.onchange({target:{name,value}})},
    render(next=current){current=next;renderExperiments(container,current,hooks)}
  };
}

test('Experiment sheet control sits before Help and invokes only the dedicated hook',async t=>{
 let imports=0;const h=await harness(t,base(),{canImport:()=>true,importFromSheet:async()=>imports++});
 assert(h.container.innerHTML.indexOf('data-exp-action="import-sheet"')<h.container.innerHTML.indexOf('data-exp-action="help"'));
 assert.match(h.container.innerHTML,/Import\/update from Experiment sheet/);
 await h.click('import-sheet');assert.equal(imports,1);assert.equal(h.saves.length,0);
});
test('Experiment editing hides import and a crafted import action preserves the complete draft',async t=>{
 let imports=0;const h=await harness(t,base(),{canImport:()=>true,importFromSheet:async()=>imports++});await h.click('new');h.set('title','Unsaved experiment');h.set('operator','Researcher A');
 assert(h.hasDraft());assert.doesNotMatch(h.container.innerHTML,/data-exp-action="import-sheet"/);assert.equal(h.resetSources(),false);
 await h.click('import-sheet');assert.equal(imports,0);assert.equal(h.container.querySelector('[name="title"]').value,'Unsaved experiment');assert.equal(h.container.querySelector('[name="operator"]').value,'Researcher A');assert.equal(h.saves.length,0);
});
test('read-only or unconfigured hooks cannot invoke import through a crafted click',async t=>{
 let imports=0;const h=await harness(t,base(),{canImport:()=>false,importFromSheet:async()=>imports++});assert.doesNotMatch(h.container.innerHTML,/data-exp-action="import-sheet"/);await h.click('import-sheet');assert.equal(imports,0);
});
test('sparse first visit and a completed import stay on current data until source history is explicitly requested',async t=>{
 let historyLoads=0;const data=base();data.tables.experiment_sources=[];const h=await harness(t,data,{historyDeferred:true,canLoadHistory:()=>true,loadSourceHistory:async()=>{historyLoads++;return base();}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(historyLoads,0);assert.match(h.container.innerHTML,/archive-tab active" data-exp-action="tab" data-id="experiments"/);
 await h.click('tab','sources');assert.equal(historyLoads,1);assert.match(h.container.innerHTML,/data-id="sources" aria-pressed="true"/);
 assert(h.resetSources());h.hooks.historyDeferred=true;h.render(data);await new Promise(resolve=>setImmediate(resolve));assert.equal(historyLoads,1);assert.match(h.container.innerHTML,/data-id="experiments" aria-pressed="true"/);
});
test('source-history load blocks import while retaining its existing asynchronous adoption guard',async t=>{
 let release,imports=0;const data=base();data.tables.experiment_sources=[];const h=await harness(t,data,{historyDeferred:true,canImport:()=>true,importFromSheet:async()=>imports++,loadSourceHistory:async()=>new Promise(resolve=>release=resolve)});
 const loading=h.click('tab','sources');assert.doesNotMatch(h.container.innerHTML,/data-exp-action="import-sheet"/);await h.click('import-sheet');assert.equal(imports,0);release(base());await loading;
});
