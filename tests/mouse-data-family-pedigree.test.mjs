import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const moduleFrom=async relative=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(relative,import.meta.url),'utf8')).toString('base64'));
const {buildFamilyPedigree,FAMILY_PEDIGREE_MAX_NODES,FAMILY_PEDIGREE_GEOMETRY}=await moduleFrom('../mouse-data/family-pedigree.js');
const {parentRoleEvidence}=await moduleFrom('../mouse-data/parentage-evidence.js');
const mouse=(id,extra={})=>({mouse_sid:String(id),sire_sids:[],dam_sids:[],sex:'Unknown',state:'Stock',...extra});
function fixture(records,{childOverride,parentsOverride,evidenceOverride}={}){
 const byId=new Map(records.map(record=>[String(record.mouse_sid),record])),calls={mouse:[],parents:[],children:[],evidence:[]};
 const parents=id=>parentsOverride?parentsOverride(id):['sire','dam'].flatMap(role=>(byId.get(String(id))?.[role+'_sids']||[]).map(parentId=>({parentId:String(parentId),role})));
 const children=new Map();for(const record of records)for(const {parentId} of parents(record.mouse_sid)){
  if(!children.has(parentId))children.set(parentId,[]);children.get(parentId).push(record);
 }
 return {records,byId,calls,adapters:{getMouse:id=>{calls.mouse.push(id);return byId.get(id)||null;},getParents:id=>{calls.parents.push(id);return parents(id);},getChildren:id=>{calls.children.push(id);return childOverride?childOverride(id):children.get(id)||[];},getParentEvidence:(childId,role)=>{calls.evidence.push({childId,role});return evidenceOverride?evidenceOverride(childId,role):parentRoleEvidence(byId.get(childId),role);}}};
}
const graph=(f,id,options)=>buildFamilyPedigree(id,f.adapters,options);
const at=(g,id)=>g.nodes.filter(node=>node.id===String(id));
function verifyGeometry(g){
 const byKey=new Map(g.nodes.map(node=>[node.key,node]));assert.equal(byKey.size,g.nodes.length);assert.equal(byKey.get(g.focusKey).x,0);assert.equal(byKey.get(g.focusKey).y,0);
 for(const node of g.nodes){assert.ok(Number.isFinite(node.x)&&Number.isFinite(node.y));assert.equal(node.y,node.generation*(node.height+g.geometry.generationGap));assert.ok(node.x-node.width/2>=g.bounds.minX&&node.x+node.width/2<=g.bounds.maxX);assert.ok(node.y-node.height/2>=g.bounds.minY&&node.y+node.height/2<=g.bounds.maxY);}
 for(const edge of g.edges){const parent=byKey.get(edge.from),child=byKey.get(edge.to);assert.ok(parent.y<child.y);assert.equal(parent.generation+1,child.generation);assert.equal(edge.parentId,parent.id);assert.equal(edge.childId,child.id);}
 for(let i=0;i<g.nodes.length;i++)for(let j=i+1;j<g.nodes.length;j++)if(g.nodes[i].generation===g.nodes[j].generation)assert.ok(Math.abs(g.nodes[i].x-g.nodes[j].x)>=g.geometry.nodeWidth+g.geometry.horizontalGap-1e-9,'same-generation cards do not overlap');
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('default two ancestor steps and one descendant step put parents above, focus center and children below',()=>{
 const f=fixture([mouse('10',{sire_sids:['11'],dam_sids:['12']}),mouse('11',{sire_sids:['13']}),mouse('12'),mouse('13',{sire_sids:['14']}),mouse('14'),mouse('20',{sire_sids:['10']}),mouse('30',{sire_sids:['20']})]);
 const g=graph(f,'10');assert.deepEqual(g.initialDepth,{ancestors:2,descendants:1});assert.equal(at(g,'10')[0].generation,0);assert.equal(at(g,'11')[0].generation,-1);assert.equal(at(g,'13')[0].generation,-2);assert.equal(at(g,'20')[0].generation,1);assert.equal(at(g,'14').length,0);assert.equal(at(g,'30').length,0);assert.deepEqual(g.frontiers.filter(x=>x.reason==='depth').map(x=>x.remainingLinks[0].id).sort(),['14','30']);verifyGeometry(g);
});
test('per-frontier parent expansion continues through twelve steps without a five-generation limit',()=>{
 const records=Array.from({length:13},(_,i)=>mouse(String(i),i<12?{sire_sids:[String(i+1)]}:{})),f=fixture(records),expandedKeys=new Set();let g=graph(f,'0',{expandedKeys});
 for(let depth=2;depth<12;depth++){
  assert.equal(Math.max(...g.nodes.map(node=>node.depth)),depth);const frontier=g.frontiers.find(item=>item.direction==='ancestors'&&item.reason==='depth');assert.ok(frontier);assert.equal(frontier.remainingCount,1);expandedKeys.add(frontier.expansionKey);g=graph(f,'0',{expandedKeys});
 }
 assert.equal(at(g,'12')[0].generation,-12);assert.equal(g.nodes.length,13);assert.equal(g.hasMore,false);assert.equal(g.activeExpansions.length,10);verifyGeometry(g);
 assert.equal(at(graph(f,'0',{ancestors:12,descendants:0}),'12').length,1);
});
test('descendant expansion beyond twelve steps uses saved child parent roles and never reverses arrows',()=>{
 const f=fixture(Array.from({length:13},(_,i)=>mouse(String(i),i>0?{dam_sids:[String(i-1)]}:{}))),expandedKeys=[];let g=graph(f,'0',{ancestors:0,expandedKeys});
 while(g.frontiers.some(item=>item.reason==='depth')){expandedKeys.push(g.frontiers.find(item=>item.reason==='depth').expansionKey);g=graph(f,'0',{ancestors:0,expandedKeys});}
 assert.equal(at(g,'12')[0].generation,12);assert.equal(g.nodes.length,13);assert.ok(g.edges.every(edge=>edge.role==='dam'));assert.ok(f.calls.evidence.every(call=>call.childId!=='0'&&call.role==='dam'));verifyGeometry(g);
});
test('explicit all includes twelve ancestor and twelve descendant steps without depth frontiers',()=>{
 const records=[mouse('0',{sire_sids:['up-1']})];
 for(let i=1;i<=12;i++){records.push(mouse('up-'+i,i<12?{sire_sids:['up-'+(i+1)]}:{}));records.push(mouse('down-'+i,{dam_sids:[i===1?'0':'down-'+(i-1)]}));}
 const f=fixture(records),g=graph(f,'0',{ancestors:'all',descendants:'all'});assert.deepEqual(g.initialDepth,{ancestors:'all',descendants:'all'});assert.equal(g.nodes.length,25);assert.equal(at(g,'up-12')[0].generation,-12);assert.equal(at(g,'down-12')[0].generation,12);assert.equal(g.frontiers.length,0);assert.equal(g.truncated,false);assert.equal(g.hasMore,false);verifyGeometry(g);
});
test('all mode remains bounded and retains every hidden immediate relative for continuation',()=>{
 const f=fixture([mouse('root'),...Array.from({length:500},(_,i)=>mouse(String(i+100),{sire_sids:['root']}))]),g=graph(f,'root',{ancestors:'all',descendants:'all'});assert.equal(g.nodes.length,200);assert.equal(g.truncated,true);assert.ok(g.frontiers.every(item=>item.reason!=='depth'));const budget=g.frontiers.find(item=>item.reason==='budget');assert.equal(budget.remainingCount,301);assert.equal(budget.remainingLinks.length,301);assert.equal(budget.continuationMouseId,'299');assert.equal(graph(f,budget.continuationMouseId,{ancestors:'all',descendants:'all'}).focusId,'299');verifyGeometry(g);
});
test('all mode still stops per-path cycles and keeps unavailable record continuations explicit',()=>{
 const f=fixture([mouse('0',{sire_sids:['1'],dam_sids:['missing']}),mouse('1',{sire_sids:['0']})]),g=graph(f,'0',{ancestors:'all',descendants:'all'});assert.ok(g.counts.cycles>0);assert.ok(g.counts.missingRecords>0);assert.ok(g.frontiers.every(item=>['cycle','record_unavailable','budget'].includes(item.reason)));assert.ok(g.frontiers.filter(item=>['cycle','record_unavailable'].includes(item.reason)).every(item=>item.remainingCount===null&&!item.canExpand));assert.ok(g.nodes.length<200);verifyGeometry(g);
});
test('a shared ancestor is repeated on both saved paths rather than treated as a global cycle',()=>{
 const f=fixture([mouse('0',{sire_sids:['1'],dam_sids:['2']}),mouse('1',{sire_sids:['3']}),mouse('2',{sire_sids:['3']}),mouse('3',{sire_sids:['4']}),mouse('4')]);
 const g=graph(f,'0',{descendants:0});assert.equal(at(g,'3').length,2);assert.ok(at(g,'3').every(node=>node.repeated&&!node.cycle&&node.occurrences===2));assert.equal(g.counts.cycles,0);
 const frontiers=g.frontiers.filter(item=>item.reason==='depth');assert.equal(frontiers.length,2);assert.notEqual(frontiers[0].expansionKey,frontiers[1].expansionKey);
 const expanded=graph(f,'0',{descendants:0,expandedKeys:[frontiers[0].expansionKey]});assert.equal(at(expanded,'4').length,1);assert.equal(expanded.activeExpansions[0].nodeKey,frontiers[0].nodeKey);assert.equal(expanded.frontiers.filter(item=>item.reason==='depth').length,1);verifyGeometry(expanded);
});
test('per-path ancestor and descendant cycles are terminal, explicit and bounded',()=>{
 const f=fixture([mouse('0',{sire_sids:['1']}),mouse('1',{dam_sids:['0']})]);
 const g=graph(f,'0',{ancestors:12,descendants:12});assert.equal(g.nodes.length,5);assert.equal(g.counts.cycles,2);assert.equal(g.frontiers.filter(item=>item.reason==='cycle').length,2);assert.ok(g.frontiers.filter(item=>item.reason==='cycle').every(item=>item.remainingCount===null&&!item.canExpand&&!item.canContinue));assert.ok(g.warnings.every(w=>w.code==='cycle'));verifyGeometry(g);
});
test('wide child sets stay within200cards and every omitted saved child remains in a budget frontier',()=>{
 const records=[mouse('root'),...Array.from({length:500},(_,i)=>mouse(String(100+i),{sire_sids:['root']}))],f=fixture(records),g=graph(f,'root');
 assert.equal(g.nodes.length,FAMILY_PEDIGREE_MAX_NODES);assert.equal(g.truncated,true);const frontier=g.frontiers.find(item=>item.reason==='budget');assert.ok(frontier);assert.equal(frontier.remainingCount,301);assert.equal(frontier.remainingLinks.length,301);assert.equal(frontier.canExpand,false);assert.equal(frontier.canContinue,true);assert.equal(frontier.continuationMouseId,'299');
 const visible=new Set(g.nodes.filter(node=>node.generation>0).map(node=>node.id));for(const link of frontier.remainingLinks){assert.equal(link.role,'sire');assert.equal(visible.has(link.id),false);visible.add(link.id);}assert.equal(visible.size,500);
 const continued=graph(f,frontier.continuationMouseId);assert.equal(continued.focusId,'299');assert.equal(at(continued,'root')[0].generation,-1);verifyGeometry(g);verifyGeometry(continued);
});
test('a full budget converts otherwise expandable depth frontiers into honest focus-continuation frontiers',()=>{
 const f=fixture([mouse('0',{sire_sids:['1']}),mouse('1',{sire_sids:['2']}),mouse('2',{sire_sids:['3']}),mouse('3')]),g=graph(f,'0',{ancestors:1,descendants:0,maxNodes:2});
 assert.equal(g.nodes.length,2);assert.equal(g.truncated,true);assert.ok(g.frontiers.every(item=>!item.canExpand));assert.equal(g.frontiers[0].reason,'budget');assert.equal(g.frontiers[0].continuationMouseId,'2');assert.deepEqual(g.frontiers[0].remainingLinks,[{id:'2',role:'sire'}]);
});
test('alternative sire/dam roles and inference confidence come from the CHILD role evidence',()=>{
 const child=mouse('4',{sire_sids:['1','1'],dam_sids:['2','3'],lineage_basis:{kind:'source_reconciliation_inference',inferred_roles:['sire'],confidence:'moderate'}}),f=fixture([mouse('1',{sex:'Male',state:'Ended'}),mouse('2',{sex:'Female',state:'Ended',app_archived_at:'2026-01-01'}),mouse('3',{sex:'Female',state:'Ended'}),child]);
 const g=graph(f,'4',{ancestors:1,descendants:0});assert.equal(g.edges.length,3);const sire=g.edges.find(e=>e.role==='sire'),dams=g.edges.filter(e=>e.role==='dam');assert.equal(sire.evidence.inferred,true);assert.equal(sire.evidence.confidence,'moderate');assert.ok(dams.every(e=>e.evidence.ambiguous&&!e.evidence.inferred));assert.ok(f.calls.evidence.every(call=>call.childId==='4'));assert.equal(at(g,'2')[0].mouse.app_archived_at,'2026-01-01');assert.ok(at(g,'1')[0].generation<0);verifyGeometry(g);
});
test('child index entries are verified against saved child fields, with no role inference from parent sex',()=>{
 const f=fixture([mouse('1',{sex:'Male'}),mouse('2',{sex:'Female',dam_sids:['1']}),mouse('3',{sire_sids:['other']})],{childOverride:id=>id==='1'?['2','2','3']:[]});
 const g=graph(f,'1',{ancestors:0,descendants:1});assert.equal(g.edges.length,1);assert.equal(g.edges[0].childId,'2');assert.equal(g.edges[0].role,'dam');assert.deepEqual(f.calls.evidence,[{childId:'2',role:'dam'}]);assert.deepEqual(g.warnings,[{code:'unmatched_child_reference',parentId:'1',childId:'3'}]);
});
test('a missing saved parent remains an unavailable placeholder with unknown continuation, not invented lineage',()=>{
 const f=fixture([mouse('10',{sire_sids:['missing-parent']})]),g=graph(f,'10',{ancestors:12,descendants:0}),missing=at(g,'missing-parent')[0];assert.equal(missing.missing,true);assert.equal(missing.mouse,null);assert.equal(missing.generation,-1);assert.equal(g.edges[0].parentId,'missing-parent');assert.equal(g.edges[0].role,'sire');const frontier=g.frontiers.find(item=>item.nodeKey===missing.key);assert.equal(frontier.reason,'record_unavailable');assert.equal(frontier.remainingCount,null);assert.deepEqual(frontier.remainingLinks,[]);assert.equal(frontier.canContinue,false);assert.ok(!f.calls.parents.includes('missing-parent'));verifyGeometry(g);
});
test('an unavailable focus is a finite placeholder and does not fabricate parent or child records',()=>{
 const f=fixture([]),g=graph(f,'unavailable');assert.equal(g.nodes.length,1);assert.equal(g.nodes[0].id,'unavailable');assert.equal(g.nodes[0].missing,true);assert.equal(g.edges.length,0);assert.equal(g.frontiers.length,2);assert.ok(g.frontiers.every(x=>x.reason==='record_unavailable'&&x.remainingCount===null));assert.equal(f.calls.parents.length,0);assert.equal(f.calls.children.length,0);verifyGeometry(g);
});
test('rawIDs, oversizedlegacy IDs and distinct stored padded IDs are never rewritten or resolved by the model',()=>{
 const f=fixture([mouse('100000',{canonical_sid:'03345',legacy_sids:['100000'],sire_sids:['1'],dam_sids:['00001']}),mouse('1',{canonical_sid:'00001'}),mouse('00001',{canonical_sid:'09000'})]),g=graph(f,'100000',{ancestors:1,descendants:0});assert.equal(g.focusId,'100000');assert.equal(at(g,'03345').length,0);assert.deepEqual(g.edges.map(e=>e.parentId),['1','00001']);assert.equal(at(g,'00001').length,1);assert.ok(f.calls.mouse.includes('100000'));assert.ok(!f.calls.mouse.includes('03345'));assert.equal(g.nodes[0].mouse.canonical_sid,'03345');
});
test('active branch expansions provide stable collapse keys and are local to an occurrence/focus',()=>{
 const f=fixture([mouse('0',{sire_sids:['1']}),mouse('1',{sire_sids:['2']}),mouse('2',{sire_sids:['3']}),mouse('3')]),initial=graph(f,'0',{ancestors:1,descendants:0}),key=initial.frontiers[0].expansionKey;
 const expanded=graph(f,'0',{ancestors:1,descendants:0,expandedKeys:new Set([key])});assert.equal(at(expanded,'2').length,1);assert.deepEqual(expanded.activeExpansions,[{nodeKey:initial.frontiers[0].nodeKey,direction:'ancestors',expansionKey:key}]);
 const collapsed=graph(f,'0',{ancestors:1,descendants:0,expandedKeys:[]});assert.equal(at(collapsed,'2').length,0);assert.deepEqual(collapsed.activeExpansions,[]);assert.equal(collapsed.frontiers[0].expansionKey,key);
 const other=graph(f,'1',{ancestors:0,descendants:0,expandedKeys:[key]});assert.equal(other.nodes.length,1);assert.equal(other.activeExpansions.length,0);
});
test('deepfrozen records/evidence/options are not mutated, and repeated builds give deterministic geometry',()=>{
 const records=freeze([mouse('0',{sire_sids:['1'],dam_sids:['2'],physical_tag:'<script>literal</script>'}),mouse('1',{sire_sids:['3']}),mouse('2',{sire_sids:['3']}),mouse('3')]),f=fixture(records,{evidenceOverride:(id,role)=>freeze({role,ids:[id],label:'Literal <evidence>',inferred:false})}),saved=JSON.stringify(records),options=freeze({ancestors:12,descendants:12,expandedKeys:[]});
 const first=graph(f,'0',options),second=graph(f,'0',options);assert.deepEqual(first,second);assert.equal(JSON.stringify(records),saved);assert.equal(first.nodes[0].mouse.physical_tag,'<script>literal</script>');assert.equal(first.edges[0].evidence.label,'Literal <evidence>');verifyGeometry(first);assert.equal(first.geometry,FAMILY_PEDIGREE_GEOMETRY);
});
test('invalid adapters, roles and limits fail explicitly rather than silently changing relationships',()=>{
 const f=fixture([mouse('0')]);assert.throws(()=>buildFamilyPedigree('0',{}),/getMouse/);for(const maxNodes of [0,201,-1,1.5])assert.throws(()=>graph(f,'0',{maxNodes}),/visible pedigree nodes/);assert.throws(()=>graph(f,'0',{ancestors:-1}),/nonnegative/);assert.throws(()=>graph(f,'0',{expandedKeys:'all'}),/expansion keys/);
 const bad={...f.adapters,getParents:()=>[{parentId:'1',role:'guessed'}]};assert.throws(()=>buildFamilyPedigree('0',bad),/sire or dam/);assert.throws(()=>buildFamilyPedigree('',f.adapters),/exact saved/);
});
