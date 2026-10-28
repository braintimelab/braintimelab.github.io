/** Display-only pedigree occurrences. Adapters supply already-visible records
 * and saved parent IDs; this module never resolves IDs or infers relationships.
 * Coordinates are card centers. Generation zero is the selected mouse. */
export const FAMILY_PEDIGREE_MAX_NODES=200;
export const FAMILY_PEDIGREE_GEOMETRY=Object.freeze({nodeWidth:260,nodeHeight:104,horizontalGap:36,generationGap:64});

const roles=new Set(['sire','dam']);
const directions=['ancestors','descendants'];
const rawId=value=>{
 if(!['string','number'].includes(typeof value)||String(value)==='')throw new TypeError('A pedigree link requires an exact saved mouse ID.');
 return String(value);
};
const steps=(value,fallback)=>{
 if(value===undefined)return fallback;
 if(value==='all')return value;
 if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Pedigree generation steps must be nonnegative integers.');
 return value;
};
const occurrenceKey=(direction,focusId,path)=>JSON.stringify([direction,focusId,...path]);
const expansionKey=(direction,key)=>JSON.stringify(['expand',direction,key]);

/**
 * buildFamilyPedigree(focusRawId, adapters, options)
 *
 * adapters.getMouse(rawId) -> visible mouse record or null
 * adapters.getParents(rawId) -> [{parentId, role:'sire'|'dam'}]
 * adapters.getChildren(rawId) -> child raw IDs or records with mouse_sid
 * adapters.getParentEvidence(childRawId, role) -> existing display evidence
 *
 * options: ancestors=2, descendants=1 (or 'all' for either direction),
 * expandedKeys=Set|array, maxNodes=200.
 * Add a depth frontier's expansionKey to reveal one more generation on that
 * occurrence path. Budget frontiers require refocusing instead of silently
 * exceeding the visible-node limit. Refocusing starts a new bounded window.
 */
export function buildFamilyPedigree(focusRawId,adapters,options={}){
 const focusId=rawId(focusRawId);
 for(const name of ['getMouse','getParents','getChildren'])if(typeof adapters?.[name]!=='function')throw new TypeError('Pedigree adapters require '+name+'.');
 const initial={ancestors:steps(options.ancestors,2),descendants:steps(options.descendants,1)};
 const maxNodes=options.maxNodes??FAMILY_PEDIGREE_MAX_NODES;
 if(!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>FAMILY_PEDIGREE_MAX_NODES)throw new TypeError('Choose between 1 and 200 visible pedigree nodes.');
 const suppliedKeys=options.expandedKeys??[];
 if(!(Array.isArray(suppliedKeys)||suppliedKeys instanceof Set)||[...suppliedKeys].some(key=>typeof key!=='string'))throw new TypeError('Pedigree expansion keys must be a Set or array of strings.');
 const expanded=new Set(suppliedKeys),nodes=[],edges=[],frontiers=[],activeExpansions=[],warnings=[];
 const mouseCache=new Map(),parentCache=new Map(),childCache=new Map(),evidenceCache=new Map();
 const getMouse=id=>{
  if(!mouseCache.has(id))mouseCache.set(id,adapters.getMouse(id)??null);
  return mouseCache.get(id);
 };
 const getParents=id=>{
  if(parentCache.has(id))return parentCache.get(id);
  const supplied=adapters.getParents(id);
  if(!Array.isArray(supplied))throw new TypeError('Pedigree parent links must be an array.');
  const result=[],seen=new Set();
  for(const link of supplied){
   if(!link||!roles.has(link.role))throw new TypeError('A saved parent link requires its sire or dam role.');
   const parentId=rawId(link.parentId),key=JSON.stringify([link.role,parentId]);
   if(!seen.has(key)){seen.add(key);result.push({parentId,role:link.role});}
  }
  parentCache.set(id,result);return result;
 };
 const getChildren=id=>{
  if(childCache.has(id))return childCache.get(id);
  const supplied=adapters.getChildren(id);
  if(!Array.isArray(supplied))throw new TypeError('Pedigree child links must be an array.');
  const children=[],seen=new Set();
  for(const child of supplied){
   const childId=rawId(child&&typeof child==='object'?child.mouse_sid??child.childId:child);
   if(seen.has(childId))continue;seen.add(childId);
   const matching=getParents(childId).filter(parent=>parent.parentId===id);
   if(!matching.length){warnings.push({code:'unmatched_child_reference',parentId:id,childId});continue;}
   // A child can reference this parent in both roles. Preserve both saved
   // relationships; never pick a role from the parent's sex or physical tag.
   for(const link of matching)children.push({childId,role:link.role});
  }
  childCache.set(id,children);return children;
 };
 const evidence=(childId,role)=>{
  const key=JSON.stringify([childId,role]);
  if(!evidenceCache.has(key))evidenceCache.set(key,typeof adapters.getParentEvidence==='function'?adapters.getParentEvidence(childId,role)??null:null);
  return evidenceCache.get(key);
 };
 const {nodeWidth,nodeHeight,horizontalGap,generationGap}=FAMILY_PEDIGREE_GEOMETRY;
 function makeNode(id,key,direction,depth,cycle=false){
  const mouse=getMouse(id),node={key,id,mouse,missing:mouse===null,generation:direction==='ancestors'?-depth:direction==='descendants'?depth:0,direction,depth,x:0,y:0,width:nodeWidth,height:nodeHeight,cycle,repeated:false};
  nodes.push(node);return node;
 }
 const focus=makeNode(focusId,occurrenceKey('focus',focusId,[]),'focus',0);
 const nodeIndex=new Map([[focus.key,focus]]);
 const treeChildren=Object.fromEntries(directions.map(direction=>[direction,new Map()]));
 const queue=directions.map(direction=>({node:focus,direction,depth:0,path:[],pathIds:new Set([focusId])}));
 let next=0;
 function continueFrom(frontier,node){
  frontier.canExpand=frontier.reason==='depth';
  frontier.continuationMouseId=frontier.reason==='budget'?frontier.remainingLinks.find(link=>getMouse(link.id)!==null)?.id??null:node.id;
  frontier.canContinue=frontier.reason!=='cycle'&&(frontier.reason==='budget'?frontier.continuationMouseId!==null:!node.missing);
 }
 function frontier(task,reason,links){
  const key=expansionKey(task.direction,task.node.key);
  const remainingLinks=links?.map(link=>({id:task.direction==='ancestors'?link.parentId:link.childId,role:link.role}))||[];
  const result={key,nodeKey:task.node.key,direction:task.direction,expansionKey:key,reason,remainingCount:links===null?null:remainingLinks.length,remainingLinks};
  continueFrom(result,task.node);frontiers.push(result);
 }
 while(next<queue.length){
  const task=queue[next++],{node,direction,depth}=task;
  if(node.cycle){frontier(task,'cycle',null);continue;}
  if(node.missing){frontier(task,'record_unavailable',null);continue;}
  const links=direction==='ancestors'?getParents(node.id):getChildren(node.id);
  if(!links.length)continue;
  if(initial[direction]!=='all'&&depth>=initial[direction]){
   const key=expansionKey(direction,node.key);
   if(!expanded.has(key)){frontier(task,'depth',links);continue;}
   activeExpansions.push({nodeKey:node.key,direction,expansionKey:key});
  }
  const descendants=[];
  for(let index=0;index<links.length;index++){
   if(nodes.length===maxNodes){frontier(task,'budget',links.slice(index));break;}
   const link=links[index],id=direction==='ancestors'?link.parentId:link.childId;
   const path=[...task.path,[link.role,id]],key=occurrenceKey(direction,focusId,path),cycle=task.pathIds.has(id);
   const relative=makeNode(id,key,direction,depth+1,cycle);nodeIndex.set(key,relative);descendants.push(key);
   const parent=direction==='ancestors'?relative:node,child=direction==='ancestors'?node:relative;
   edges.push({key:JSON.stringify([parent.key,child.key,link.role]),from:parent.key,to:child.key,parentKey:parent.key,childKey:child.key,parentId:parent.id,childId:child.id,role:link.role,evidence:evidence(child.id,link.role),cycle});
   if(cycle)warnings.push({code:'cycle',nodeKey:key,mouseId:id,direction});
   queue.push({node:relative,direction,depth:depth+1,path,pathIds:new Set([...task.pathIds,id])});
  }
  treeChildren[direction].set(node.key,descendants);
 }
 if(nodes.length===maxNodes)for(const frontier of frontiers)if(frontier.reason==='depth'){
  frontier.reason='budget';continueFrom(frontier,nodeIndex.get(frontier.nodeKey));
 }

 // Each half is a bounded occurrence tree, not a globally de-duplicated graph:
 // pedigree collapse and shared ancestors remain visible on every saved path.
 // Compute subtree widths bottom-up, then center both halves on the focus.
 for(const direction of directions){
  const children=treeChildren[direction],order=[focus.key];
  for(let i=0;i<order.length;i++)order.push(...(children.get(order[i])||[]));
  const widths=new Map();
  for(let i=order.length-1;i>=0;i--){
   const key=order[i],keys=children.get(key)||[];
   widths.set(key,Math.max(nodeWidth,keys.reduce((sum,key)=>sum+widths.get(key),0)+Math.max(0,keys.length-1)*horizontalGap));
  }
  const positions=[{key:focus.key,left:-widths.get(focus.key)/2}];
  for(let i=0;i<positions.length;i++){
   const {key,left}=positions[i],node=nodeIndex.get(key),keys=children.get(key)||[],width=widths.get(key);
   if(node!==focus){node.x=left+width/2;node.y=node.generation*(nodeHeight+generationGap);}
   const childWidth=keys.reduce((sum,key)=>sum+widths.get(key),0)+Math.max(0,keys.length-1)*horizontalGap;
   let childLeft=left+(width-childWidth)/2;
   for(const key of keys){positions.push({key,left:childLeft});childLeft+=widths.get(key)+horizontalGap;}
  }
 }
 const occurrences=new Map();for(const node of nodes)occurrences.set(node.id,(occurrences.get(node.id)||0)+1);
 for(const node of nodes){node.repeated=occurrences.get(node.id)>1;node.occurrences=occurrences.get(node.id);}
 const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
 for(const node of nodes){bounds.minX=Math.min(bounds.minX,node.x-node.width/2);bounds.maxX=Math.max(bounds.maxX,node.x+node.width/2);bounds.minY=Math.min(bounds.minY,node.y-node.height/2);bounds.maxY=Math.max(bounds.maxY,node.y+node.height/2);}
 bounds.width=bounds.maxX-bounds.minX;bounds.height=bounds.maxY-bounds.minY;
 return {focusKey:focus.key,focusId,initialDepth:initial,maxNodes,nodes,edges,frontiers,activeExpansions,bounds,geometry:FAMILY_PEDIGREE_GEOMETRY,warnings,
  truncated:frontiers.some(frontier=>frontier.reason==='budget'),hasMore:frontiers.some(frontier=>['depth','budget'].includes(frontier.reason)),
  counts:{visibleNodes:nodes.length,uniqueMouseIds:occurrences.size,ancestors:nodes.filter(node=>node.generation<0).length,descendants:nodes.filter(node=>node.generation>0).length,missingRecords:nodes.filter(node=>node.missing).length,cycles:nodes.filter(node=>node.cycle).length,frontiers:frontiers.length,remainingOccurrenceLinks:frontiers.reduce((sum,frontier)=>sum+(frontier.remainingCount??0),0)}};
}
