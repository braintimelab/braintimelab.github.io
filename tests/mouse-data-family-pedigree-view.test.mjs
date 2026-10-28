import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async name=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../mouse-data/'+name,import.meta.url),'utf8')).toString('base64'));
const {pedigreeViewBox,zoomPedigreeViewport,fitPedigreeViewport,renderPedigreeSVG,mountPedigreeViewport}=await load('family-pedigree-view.js');
const {buildFamilyPedigree}=await load('family-pedigree.js');
const {parentRoleEvidence}=await load('parentage-evidence.js');
const {formatMouseSid}=await load('mouse-sid.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} is close to ${b}`);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function fixture(extra={}){
 const records=[{mouse_sid:'100000',canonical_sid:'03345',physical_tag:'FOCUS-M1',sex:'Male',state:'Stock',sire_sids:['1'],dam_sids:['2'],lineage_basis:{kind:'source_reconciliation_inference',inferred_roles:['sire'],confidence:'moderate'},...extra.focus},{mouse_sid:'1',physical_tag:'SIRE',sex:'Male',state:'Ended',sire_sids:['3'],dam_sids:[]},{mouse_sid:'2',physical_tag:'DAM',sex:'Female',state:'Ended',sire_sids:[],dam_sids:[]},{mouse_sid:'3',physical_tag:'GRANDSIRE',sex:'Male',state:'Ended',sire_sids:['4'],dam_sids:[]},{mouse_sid:'4',physical_tag:'OLDER',sex:'Male',state:'Ended',sire_sids:[],dam_sids:[]},{mouse_sid:'20',physical_tag:'CHILD',sex:'Unknown',state:'Stock',sire_sids:['100000'],dam_sids:[]},{mouse_sid:'30',physical_tag:'GRANDCHILD',sex:'Unknown',state:'Stock',sire_sids:['20'],dam_sids:[]},...(extra.records||[])];
 const dataset={tables:{mice:records}},index=new Map(records.map(m=>[m.mouse_sid,m]));
 const parents=id=>['sire','dam'].flatMap(role=>(index.get(id)?.[role+'_sids']||[]).map(parentId=>({parentId,role})));
 const model=buildFamilyPedigree('100000',{getMouse:id=>index.get(id)||null,getParents:parents,getChildren:id=>records.filter(child=>parents(child.mouse_sid).some(link=>link.parentId===id)),getParentEvidence:(id,role)=>parentRoleEvidence(index.get(id),role)},extra.options||{});
 return {dataset,index,model,presentationFor:node=>({sid:formatMouseSid(node.id,dataset),genotype:node.id==='100000'?'Unclassified':'Bmal1(+/+)',evidence:node.id==='100000'?'Genotype not recorded':'Confirmed profile'})};
}
class FakeEvent{
 constructor(type,props={}){Object.assign(this,{type,bubbles:true,cancelable:true,detail:0,defaultPrevented:false,propagationStopped:false},props);}
 preventDefault(){if(this.cancelable)this.defaultPrevented=true;}
 stopPropagation(){this.propagationStopped=true;}
}
class FakeResizeObserver{
 static instances=[];
 constructor(callback){this.callback=callback;this.disconnected=false;this.observed=[];FakeResizeObserver.instances.push(this);}
 observe(element){this.observed.push(element);}
 disconnect(){this.disconnected=true;}
 trigger({queued=false}={}){if(!this.disconnected||queued)this.callback();}
}
class FakeViewport{
 constructor(){this.rect={left:40,top:60,width:1000,height:720};this.clientWidth=1000;this.clientHeight=720;this.dataset={};this.listeners=[];this.captured=new Set();this.focusCalls=0;this.attributeWrites=[];this.bubbled=[];this.classes=new Set();this.classList={add:token=>this.classes.add(token),remove:token=>this.classes.delete(token)};this.svg={attrs:new Map(),setAttribute:(key,value)=>{this.svg.attrs.set(key,value);this.attributeWrites.push([key,value]);}};this.ownerDocument={defaultView:{MouseEvent:FakeEvent,ResizeObserver:FakeResizeObserver}};}
 querySelector(selector){return selector==='[data-pedigree-svg]'?this.svg:null;}
 getBoundingClientRect(){return {...this.rect};}
 addEventListener(type,handler,options){this.listeners.push({type,handler,options,capture:options===true||options?.capture===true});}
 removeEventListener(type,handler,options){const i=this.listeners.findIndex(item=>item.type===type&&item.handler===handler&&item.capture===(options===true||options?.capture===true));if(i>=0)this.listeners.splice(i,1);}
 setPointerCapture(id){this.captured.add(id);}
 hasPointerCapture(id){return this.captured.has(id);}
 releasePointerCapture(id){this.captured.delete(id);}
 focus(){this.focusCalls++;}
 closest(){return null;}
 emit(type,props={}){const event=props instanceof FakeEvent?props:new FakeEvent(type,props);event.target??=this;const all=[...this.listeners].filter(item=>item.type===type);for(const capture of [true,false])for(const item of all.filter(item=>item.capture===capture)){if(event.propagationStopped)return event;item.handler(event);}if(!event.propagationStopped&&event.bubbles)this.bubbled.push({type,target:event.target,defaultPrevented:event.defaultPrevented});return event;}
}
// Controls bubble through the exact viewport capture handler before the host's
// delegated FamilyExplorer handler; this catches accidental post-drag refocus.
function control(element,action='focus',id='100000'){
 const target={dataset:{familyAction:action,id},clicks:0,closest:()=>target,dispatchEvent(event){target.clicks++;event.target=target;element.emit(event.type,event);return !event.defaultPrevented;}};return target;
}
function mount({initial={cx:0,cy:0,scale:1},model=fixture().model}={}){
 const element=new FakeViewport(),changes=[],controller=mountPedigreeViewport(element,model,{initial,onChange:value=>changes.push(value)}),observer=FakeResizeObserver.instances.at(-1);
 return {element,changes,controller,observer,last:()=>changes.at(-1),point:(x,y)=>({clientX:element.rect.left+x,clientY:element.rect.top+y})};
}
const world=(state,point,size)=>({x:state.cx+(point.x-size.width/2)/state.scale,y:state.cy+(point.y-size.height/2)/state.scale});

test('viewBox and zoom math keep the exact world point under a screen anchor fixed',()=>{
 assert.deepEqual(pedigreeViewBox({cx:10,cy:20,scale:2},800,600),{x:-190,y:-130,width:400,height:300});
 const before={cx:37,cy:-83,scale:.6},point={x:781,y:103},size={width:1000,height:720},after=zoomPedigreeViewport(before,1.5,point,size);near(world(before,point,size).x,world(after,point,size).x);near(world(before,point,size).y,world(after,point,size).y);near(after.scale,.9);
 assert.equal(zoomPedigreeViewport(before,100000,point,size).scale,3);assert.equal(zoomPedigreeViewport({cx:0,cy:0,scale:.005},.01,point,size).scale,.005);assert.ok(Object.values(pedigreeViewBox({cx:NaN,cy:Infinity,scale:NaN},0,0)).every(Number.isFinite));
});
test('true Fit zooms below one and includes all graph bounds with padding',()=>{
 const bounds={minX:-30000,maxX:30000,minY:-18000,maxY:12000},size={width:1000,height:720},fit=fitPedigreeViewport(bounds,size),box=pedigreeViewBox(fit,size.width,size.height);assert.ok(fit.scale<1);assert.equal(fit.cx,0);assert.equal(fit.cy,-3000);assert.ok(box.x<=bounds.minX-48);assert.ok(box.x+box.width>=bounds.maxX+48);assert.ok(box.y<=bounds.minY-48);assert.ok(box.y+box.height>=bounds.maxY+48);
});
test('actual SVG has parent-to-child downward arrows, selected card at0 and rawidentity navigation',()=>{
 const f=fixture(),html=renderPedigreeSVG(f.model,{presentationFor:f.presentationFor}),nodes=new Map(f.model.nodes.map(n=>[n.key,n]));assert.match(html,/Ancestors above, selected mouse in the center, children below/);assert.match(html,/class="pedigree-node is-focus"[^>]+data-id="100000"/);assert.match(html,/<rect x="-130" y="-52" width="260" height="104"/);assert.match(html,/SID 03345/);assert.doesNotMatch(html,/data-id="03345"/);
 for(const edge of f.model.edges){const p=nodes.get(edge.parentKey),c=nodes.get(edge.childKey),start=p.y+p.height/2,end=c.y-c.height/2;assert.ok(start<end);assert.ok(html.includes('d="M '+p.x+' '+start+' C '));assert.ok(html.includes(', '+c.x+' '+end+'"'));}assert.ok(html.includes('marker-end="url(#pedigree-'));assert.ok(f.model.nodes.some(n=>n.generation<0)&&f.model.nodes.some(n=>n.generation>0));
});
test('SVG uncertainty and alternative labels stay role-specific and derive from child evidence',()=>{
 const single=fixture(),one=renderPedigreeSVG(single.model,{presentationFor:single.presentationFor});assert.equal((one.match(/stroke-dasharray="5 4"/g)||[]).length,1);assert.match(one,/Sire of SID 03345:[^"]*moderate/);assert.match(one,/>sire inferred<\/text>/);assert.match(one,/>dam<\/text>/);
 const alternatives=fixture({focus:{sire_sids:[],dam_sids:['1','2'],lineage_basis:null},options:{ancestors:1,descendants:0}}),two=renderPedigreeSVG(alternatives.model,{presentationFor:alternatives.presentationFor});assert.equal((two.match(/stroke-dasharray="5 4"/g)||[]).length,2);assert.equal((two.match(/>dam \?<\/text>/g)||[]).length,2);assert.doesNotMatch(two,/>dam inferred/);
});
test('expand/collapse controls are accessible and retain opaque occurrence keys',()=>{
 const f=fixture(),frontier=f.model.frontiers.find(item=>item.canExpand&&item.direction==='ancestors'),initial=renderPedigreeSVG(f.model,{presentationFor:f.presentationFor});assert.ok(frontier);assert.match(initial,/role="button" tabindex="0" data-family-action="pedigree-expand"/);assert.match(initial,/aria-label="Show earlier ancestors of SID 00003"/);
 const records=[...f.dataset.tables.mice],index=f.index,expanded=buildFamilyPedigree('100000',{getMouse:id=>index.get(id)||null,getParents:id=>['sire','dam'].flatMap(role=>(index.get(id)?.[role+'_sids']||[]).map(parentId=>({parentId,role}))),getChildren:id=>records.filter(child=>[...(child.sire_sids||[]),...(child.dam_sids||[])].includes(id)),getParentEvidence:(id,role)=>parentRoleEvidence(index.get(id),role)},{expandedKeys:[frontier.expansionKey]});
 const html=renderPedigreeSVG(expanded,{presentationFor:f.presentationFor});assert.match(html,/role="button" tabindex="0" data-family-action="pedigree-collapse"/);assert.match(html,/aria-label="Collapse earlier ancestors of SID 00003"/);assert.ok(html.includes(frontier.expansionKey.replaceAll('&','&amp;').replaceAll('"','&quot;')));
});
test('SVG escapes every source/presentation field and does not mutate frozen model or records',()=>{
 const raw='raw"><script>bad()</script>',f=fixture({focus:{physical_tag:'<img src=x onerror="bad()">',sire_sids:[raw]},records:[{mouse_sid:raw,physical_tag:'<ancestor>',state:'Ended',sire_sids:[],dam_sids:[]}]});f.model.edges[0].evidence={...f.model.edges[0].evidence,title:'"><script>edge()</script>',edgeLabel:'<img src=x onerror=bad()>'};const model=freeze(f.model),saved=JSON.stringify(model);const html=renderPedigreeSVG(model,{presentationFor:node=>({tag:node.mouse?.physical_tag,sid:'"<sid>',sex:'<sex>',genotype:'<script>bad()</script>',evidence:'<evidence>',state:'<state>'})});assert.doesNotMatch(html,/<img src=x|<script>bad|<script>edge|data-id="03345"/);assert.match(html,/&lt;img src=x/);assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(html,/SID &quot;&lt;sid&gt;/);assert.match(html,/data-id="raw&quot;&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;"/);assert.match(html,/&lt;script&gt;edge\(\)&lt;\/script&gt;/);assert.equal(JSON.stringify(model),saved);
});
test('missing records are disabled placeholders and never acquire a guessed parent genotype',()=>{
 const f=fixture({focus:{sire_sids:['absent'],dam_sids:[]}}),html=renderPedigreeSVG(f.model,{presentationFor:node=>({sid:node.id})});assert.match(html,/pedigree-node is-missing" role="img" aria-disabled="true"/);assert.match(html,/Record unavailable/);assert.doesNotMatch(html,/data-id="absent"/);assert.match(html,/Genotype not recorded/);
});
test('unknown genotype with no presentation evidence is never labelled as recorded evidence',()=>{
 const f=fixture(),html=renderPedigreeSVG(f.model);assert.match(html,/Genotype not recorded/);assert.doesNotMatch(html,/Recorded genotype evidence/,'an absent evidence value must remain unknown');
});
test('Center keeps selectedmouse atviewportcenter, Fit uses fullbounds and controller zoom anchors screen center',()=>{
 const f=fixture(),m=mount({initial:{cx:120,cy:300,scale:.5},model:f.model});m.controller.center();assert.equal(m.last().cx,0);assert.equal(m.last().cy,0);assert.ok(m.last().scale<=.95);m.controller.fit();const fit=fitPedigreeViewport(f.model.bounds,{width:1000,height:720});assert.deepEqual(m.last(),fit);const before={...m.last()};m.controller.zoomIn();near(m.last().cx,before.cx);near(m.last().cy,before.cy);near(m.last().scale,Math.min(3,before.scale*1.25));m.controller.zoomOut();near(m.last().scale,before.scale);m.controller.destroy();
});
test('Arrow/Home/F/+/- keyboard controls pan/center/Fit/zoom only from the viewport',()=>{
 const m=mount(),e=m.element;for(const [key,cx,cy] of [['ArrowLeft',-55,0],['ArrowRight',0,0],['ArrowUp',0,-55],['ArrowDown',0,0]]){const event=e.emit('keydown',{key});assert.equal(event.defaultPrevented,true);near(m.last().cx,cx);near(m.last().cy,cy);}e.emit('keydown',{key:'+'});near(m.last().scale,1.25);e.emit('keydown',{key:'-'});near(m.last().scale,1);e.emit('keydown',{key:'F'});assert.deepEqual(m.last(),fitPedigreeViewport(fixture().model.bounds,{width:1000,height:720}));e.emit('keydown',{key:'Home'});assert.equal(m.last().cx,0);assert.equal(m.last().cy,0);const before={...m.last()},target=control(e);const event=e.emit('keydown',{target,key:'ArrowRight'});assert.equal(event.defaultPrevented,false);assert.deepEqual(m.last(),before);m.controller.destroy();
});
test('Enter and Space activate focus/branch controls exactly once through delegated clicks',()=>{
 const m=mount(),e=m.element;for(const action of ['focus','pedigree-expand','pedigree-collapse'])for(const key of ['Enter',' ']){const target=control(e,action),before=e.bubbled.filter(x=>x.type==='click').length,event=e.emit('keydown',{target,key});assert.equal(event.defaultPrevented,true);assert.equal(target.clicks,1);assert.equal(e.bubbled.filter(x=>x.type==='click').length,before+1);}m.controller.destroy();
});
test('blankcanvas drag pans correctly and suppresses the one accidental postdrag focus click',()=>{
 const m=mount(),e=m.element,target=control(e);e.emit('pointerdown',{pointerId:1,pointerType:'mouse',button:0,...m.point(100,100)});assert.equal(e.focusCalls,1);e.emit('pointermove',{pointerId:1,pointerType:'mouse',...m.point(140,130)});near(m.last().cx,-40);near(m.last().cy,-30);assert.equal(e.hasPointerCapture(1),true);e.emit('pointerup',{pointerId:1});assert.equal(e.captured.size,0);const first=e.emit('click',{target,detail:1});assert.equal(first.defaultPrevented,true);assert.equal(first.propagationStopped,true);const second=e.emit('click',{target,detail:1});assert.equal(second.defaultPrevented,false);assert.equal(second.propagationStopped,false);m.controller.destroy();
});
test('mouse card press never starts viewportpan and touch card tap still reaches focus',()=>{
 const m=mount(),e=m.element,target=control(e),before={...m.last()};e.emit('pointerdown',{target,pointerId:1,pointerType:'mouse',button:0,...m.point(100,100)});e.emit('pointermove',{target,pointerId:1,pointerType:'mouse',...m.point(180,160)});assert.deepEqual(m.last(),before);assert.equal(e.captured.size,0);e.emit('pointerdown',{target,pointerId:2,pointerType:'touch',button:0,...m.point(400,300)});e.emit('pointerup',{target,pointerId:2,pointerType:'touch'});const click=e.emit('click',{target});assert.equal(click.defaultPrevented,false);assert.equal(click.propagationStopped,false);m.controller.destroy();
});
test('tiny touch movement on a card remains a native tap without pan, capture or click suppression',()=>{
 const m=mount(),e=m.element,target=control(e),before={...m.last()},count=e.bubbled.filter(event=>event.type==='click').length;
 assert.equal(e.emit('pointerdown',{target,pointerId:1,pointerType:'touch',button:0,...m.point(400,300)}).defaultPrevented,false);
 const jitter=e.emit('pointermove',{target,pointerId:1,pointerType:'touch',...m.point(402,301)});assert.equal(jitter.defaultPrevented,false);assert.deepEqual(m.last(),before);assert.equal(e.captured.size,0);assert.equal(e.classes.has('is-panning'),false);
 e.emit('pointerup',{target,pointerId:1});const click=e.emit('click',{target,detail:1});assert.equal(click.defaultPrevented,false);assert.equal(click.propagationStopped,false);assert.equal(e.bubbled.filter(event=>event.type==='click').length,count+1);m.controller.destroy();
});
test('pinch starting on either nodecards or blankcanvas zooms around the moving midpoint without accidental focus',()=>{
 for(const onCards of [true,false]){const m=mount(),e=m.element,a=onCards?control(e):e,b=onCards?control(e,'focus','1'):e;const first=e.emit('pointerdown',{target:a,pointerId:1,pointerType:'touch',button:0,...m.point(400,300)});assert.equal(first.defaultPrevented,!onCards);const second=e.emit('pointerdown',{target:b,pointerId:2,pointerType:'touch',button:0,...m.point(600,300)});assert.equal(second.defaultPrevented,true);assert.equal(e.captured.size,2);e.emit('pointermove',{target:b,pointerId:2,pointerType:'touch',...m.point(800,300)});near(m.last().scale,2);near(m.last().cx,-50);near(m.last().cy,-30);e.emit('pointerup',{pointerId:2});e.emit('pointerup',{pointerId:1});assert.equal(e.captured.size,0);assert.equal(e.emit('click',{target:a,detail:1}).defaultPrevented,true);const tap=control(e);e.emit('pointerdown',{target:tap,pointerId:3,pointerType:'touch',button:0,...m.point(500,400)});e.emit('pointerup',{pointerId:3});assert.equal(e.emit('click',{target:tap,detail:1}).defaultPrevented,false);m.controller.destroy();}
});
test('a gesture without a trailing pointer click cannot swallow a subsequent keyboard branch activation',()=>{
 const m=mount(),e=m.element,node=control(e);e.emit('pointerdown',{target:node,pointerId:1,pointerType:'touch',button:0,...m.point(300,300)});e.emit('pointerdown',{target:node,pointerId:2,pointerType:'touch',button:0,...m.point(600,300)});e.emit('pointermove',{target:node,pointerId:2,pointerType:'touch',...m.point(800,300)});e.emit('pointerup',{pointerId:1});e.emit('pointerup',{pointerId:2});const branch=control(e,'pedigree-expand'),before=e.bubbled.filter(event=>event.type==='click').length;e.emit('keydown',{target:branch,key:'Enter'});assert.equal(branch.clicks,1);assert.equal(e.bubbled.filter(event=>event.type==='click').length,before+1);m.controller.destroy();
});
test('ordinary wheel remains page scrolling; modifierwheel zooms around exact cursor',()=>{
 const m=mount(),e=m.element,before={...m.last()},point={x:750,y:220};assert.equal(e.emit('wheel',{deltaY:100,...m.point(point.x,point.y)}).defaultPrevented,false);assert.deepEqual(m.last(),before);const wheel=e.emit('wheel',{ctrlKey:true,deltaY:-50,...m.point(point.x,point.y)});assert.equal(wheel.defaultPrevented,true);near(world(before,point,{width:1000,height:720}).x,world(m.last(),point,{width:1000,height:720}).x);near(world(before,point,{width:1000,height:720}).y,world(m.last(),point,{width:1000,height:720}).y);assert.ok(m.last().scale>before.scale);m.controller.destroy();
});
test('resize refreshes viewBox and destroy removes listeners/observer so oldcontext cannot update a new view',()=>{
 const m=mount({initial:{cx:18,cy:-20,scale:.5}}),e=m.element;assert.ok(e.listeners.length>5);e.rect.width=500;e.rect.height=400;m.observer.trigger();assert.equal(e.svg.attrs.get('viewBox'),[-482,-420,1000,800].join(' '));const changes=m.changes.length;m.controller.destroy();assert.equal(e.listeners.length,0);assert.equal(m.observer.disconnected,true);e.emit('keydown',{key:'ArrowRight'});m.observer.trigger({queued:true});m.controller.fit();m.controller.zoomIn();assert.equal(m.changes.length,changes);const next=[];const current=mountPedigreeViewport(e,fixture().model,{initial:{cx:7,cy:9,scale:1},onChange:s=>next.push(s)});m.observer.trigger({queued:true});assert.deepEqual(next.at(-1),{cx:7,cy:9,scale:1});e.emit('keydown',{key:'ArrowRight'});assert.deepEqual(next.at(-1),{cx:62,cy:9,scale:1});current.destroy();
});
test('destroy during an active captured gesture releases every pointer capture',()=>{
 const m=mount(),e=m.element;e.emit('pointerdown',{pointerId:1,pointerType:'touch',button:0,...m.point(200,300)});e.emit('pointerdown',{pointerId:2,pointerType:'touch',button:0,...m.point(600,300)});assert.equal(e.captured.size,2);m.controller.destroy();assert.equal(e.captured.size,0,'retaining capture would intercept a later component gesture');assert.equal(e.classes.has('is-panning'),false);assert.equal(e.listeners.length,0);
});
