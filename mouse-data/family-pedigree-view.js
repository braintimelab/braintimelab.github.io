// Display-only SVG and viewport controls. Relationship selection belongs to
// family-pedigree.js; browsing never changes an animal or its parent links.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clampScale=value=>Math.min(3,Math.max(.005,finite(value,1)));
const short=(value,length)=>String(value??'').length>length?String(value).slice(0,length-1)+'…':String(value??'');
const validViewport=value=>({cx:finite(value?.cx),cy:finite(value?.cy),scale:clampScale(value?.scale??1)});
const markerId=key=>{let hash=2166136261;for(const char of String(key))hash=Math.imul(hash^char.charCodeAt(0),16777619);return 'pedigree-'+(hash>>>0).toString(36);};

export function pedigreeViewBox(viewport,width,height){
 const view=validViewport(viewport),w=Math.max(1,finite(width,1000)),h=Math.max(1,finite(height,720));
 return {x:view.cx-w/(2*view.scale),y:view.cy-h/(2*view.scale),width:w/view.scale,height:h/view.scale};
}

/** Keep the world coordinate under the supplied screen point fixed. */
export function zoomPedigreeViewport(viewport,factor,point,size){
 const before=validViewport(viewport),width=Math.max(1,finite(size?.width,1000)),height=Math.max(1,finite(size?.height,720));
 const x=finite(point?.x,width/2)-width/2,y=finite(point?.y,height/2)-height/2;
 const scale=clampScale(before.scale*Math.max(.01,finite(factor,1)));
 return {cx:before.cx+x/before.scale-x/scale,cy:before.cy+y/before.scale-y/scale,scale};
}

export function fitPedigreeViewport(bounds,size,padding=48){
 const width=Math.max(1,finite(size?.width,1000)),height=Math.max(1,finite(size?.height,720));
 const minX=finite(bounds?.minX,-130),maxX=finite(bounds?.maxX,130),minY=finite(bounds?.minY,-52),maxY=finite(bounds?.maxY,52);
 return {cx:(minX+maxX)/2,cy:(minY+maxY)/2,scale:clampScale(Math.min(1.2,width/Math.max(1,maxX-minX+padding*2),height/Math.max(1,maxY-minY+padding*2)))};
}

export function renderPedigreeSVG(model,{presentationFor}={}){
 const index=new Map(model.nodes.map(node=>[node.key,node])),presentations=new Map();
 const presentation=node=>{
  if(!presentations.has(node.key)){
   const supplied=presentationFor?.(node)||{};
   presentations.set(node.key,{tag:supplied.tag||node.mouse?.physical_tag||'Untagged',completeMouse:supplied.completeMouse===true,loadMouse:supplied.loadMouse===true,sid:supplied.sid??node.id,sex:supplied.sex||node.mouse?.sex||'Unknown',genotype:supplied.genotype||'Genotype not recorded',evidence:supplied.evidence||'',state:supplied.state||node.mouse?.state||''});
  }
  return presentations.get(node.key);
 };
 const prefix=markerId(model.focusKey),focus=index.get(model.focusKey),focusLabel=focus?presentation(focus).sid:model.focusId;
 const edges=model.edges.map(edge=>{
  const parent=index.get(edge.parentKey),child=index.get(edge.childKey);if(!parent||!child)return '';
  const evidence=edge.evidence||{},uncertain=Boolean(evidence.uncertain||evidence.inferred||evidence.ambiguous);
  const kind=edge.cycle?'cycle':uncertain?'uncertain':'recorded',color=edge.cycle?'var(--red,#a63939)':uncertain?'var(--amber)':'var(--accent)';
  const startY=parent.y+parent.height/2,endY=child.y-child.height/2,middle=(startY+endY)/2;
  const role=edge.role==='sire'?'Sire':'Dam',label=evidence.edgeLabel||role.toLowerCase();
  const title=role+' of SID '+presentation(child).sid+': '+(evidence.title||'Saved parent reference')+(edge.cycle?' · Cycle detected; branch stopped':'');
  return '<g class="pedigree-edge '+kind+'" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><path d="M '+parent.x+' '+startY+' C '+parent.x+' '+middle+', '+child.x+' '+middle+', '+child.x+' '+endY+'" fill="none" stroke="'+color+'" stroke-width="1.7"'+(uncertain||edge.cycle?' stroke-dasharray="5 4"':'')+' marker-end="url(#'+prefix+'-'+kind+')"/><text x="'+((parent.x+child.x)/2+6)+'" y="'+(middle-5)+'" class="pedigree-edge-label" fill="'+color+'">'+esc(label)+'</text></g>';
 }).join('');
 const cards=model.nodes.map(node=>{
  const p=presentation(node),selected=node.key===model.focusKey,available=!node.missing;
  const extra=node.cycle?'Cycle detected · expansion stopped':node.missing?'Record unavailable':p.evidence;
  const title=[p.tag,'SID '+p.sid,p.sex,p.state,p.genotype,extra,node.repeated?'This saved mouse occurs on more than one branch':''].filter(Boolean).join(' · ');
  const complete=available&&(p.completeMouse||p.loadMouse),focusAttrs='data-family-action="focus" data-id="'+esc(node.id)+'"',tagAttrs=complete?' role="button" tabindex="0" data-family-action="'+(p.loadMouse?'load-mouse':'complete-mouse')+'" data-id="'+esc(node.id)+'" aria-label="'+(p.loadMouse?'Load full record to complete':'Complete mouse details')+' · SID '+esc(p.sid)+'"':'',sidAttrs=complete?' role="button" tabindex="0" '+focusAttrs+' aria-label="Show family of SID '+esc(p.sid)+'"':'';
  return '<g class="pedigree-node'+(selected?' is-focus':'')+(node.missing?' is-missing':'')+(node.cycle?' is-cycle':'')+'" '+(available?(complete?'role="group" ':'role="button" tabindex="0" ')+focusAttrs:'role="img" aria-disabled="true"')+' aria-label="'+esc((available?'Center family on ':'Unavailable record ')+title)+'"><title>'+esc(title)+'</title><rect x="'+(node.x-node.width/2)+'" y="'+(node.y-node.height/2)+'" width="'+node.width+'" height="'+node.height+'" rx="9"/><text x="'+(node.x-node.width/2+14)+'" y="'+(node.y-28)+'" class="pedigree-node-tag"'+tagAttrs+'>'+esc(short(p.tag,32))+'</text><text x="'+(node.x-node.width/2+14)+'" y="'+(node.y-7)+'" class="pedigree-node-id"'+sidAttrs+'>SID '+esc(p.sid)+' · '+esc(p.sex)+(p.state?' · '+esc(p.state):'')+'</text><text x="'+(node.x-node.width/2+14)+'" y="'+(node.y+14)+'" class="pedigree-node-genotype">'+esc(short(p.genotype,38))+'</text><text x="'+(node.x-node.width/2+14)+'" y="'+(node.y+35)+'" class="pedigree-node-evidence">'+esc(short(extra||'Evidence not recorded',40))+'</text>'+(node.repeated&&!selected?'<text x="'+(node.x+node.width/2-13)+'" y="'+(node.y-29)+'" class="pedigree-repeat" aria-hidden="true">↗</text>':'')+'</g>';
 }).join('');
 function branchButton(item,collapse){
  const node=index.get(item.nodeKey);if(!node)return '';
  const upward=item.direction==='ancestors',x=node.x+node.width/2-28,y=node.y+(upward?-1:1)*(node.height/2+18);
  const p=presentation(node),label=(collapse?'Collapse ':'Show ')+(upward?'earlier ancestors':'later descendants')+' of SID '+p.sid;
  const symbol=collapse?'−':'+',count=collapse?'':item.remainingCount>1?String(item.remainingCount):'';
  return '<g class="pedigree-branch-control" role="button" tabindex="0" data-family-action="'+(collapse?'pedigree-collapse':'pedigree-expand')+'" data-key="'+esc(item.expansionKey)+'" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title><rect x="'+(x-22)+'" y="'+(y-12)+'" width="44" height="24" rx="7"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle">'+symbol+esc(count)+'</text></g>';
 }
 const controls=model.frontiers.filter(item=>item.canExpand).map(item=>branchButton(item,false)).join('')+(model.activeExpansions||[]).map(item=>branchButton(item,true)).join('');
 const markers=['recorded','uncertain','cycle'].map(kind=>'<marker id="'+prefix+'-'+kind+'" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="'+(kind==='cycle'?'var(--red,#a63939)':kind==='uncertain'?'var(--amber)':'var(--accent)')+'"/></marker>').join('');
 return '<div class="pedigree-viewport" data-pedigree-viewport tabindex="0" role="group" aria-label="Explorable pedigree. Ancestors above, selected mouse in the center, children below. Drag to pan; use zoom controls or pinch."><svg class="pedigree-svg" data-pedigree-svg width="100%" height="100%" viewBox="-500 -360 1000 720" role="group" aria-label="Pedigree for SID '+esc(focusLabel)+'"><defs>'+markers+'</defs>'+edges+cards+controls+'</svg></div>';
}

/** Pointer and keyboard navigation only. All state is in-memory view state. */
export function mountPedigreeViewport(element,model,{initial,onChange}={}){
 const svg=element?.querySelector?.('[data-pedigree-svg]');if(!element||!svg)return {zoomIn(){},zoomOut(){},fit(){},center(){},destroy(){}};
 let disposed=false,state=validViewport(initial),size={width:1000,height:720},pointers=new Map(),pan=null,pinch=null,suppressClick=false;
 const listeners=[],listen=(type,handler,options)=>{element.addEventListener(type,handler,options);listeners.push(()=>element.removeEventListener(type,handler,options));};
 function dimensions(){const rect=element.getBoundingClientRect?.()||{};size={width:Math.max(1,finite(rect.width,element.clientWidth||1000)),height:Math.max(1,finite(rect.height,element.clientHeight||720))};return rect;}
 function draw(){if(disposed)return;const box=pedigreeViewBox(state,size.width,size.height);svg.setAttribute('viewBox',[box.x,box.y,box.width,box.height].join(' '));element.dataset.zoomPercent=String(Math.round(state.scale*100));onChange?.({...state});}
 function local(event){const rect=element.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
 function world(point){return {x:state.cx+(point.x-size.width/2)/state.scale,y:state.cy+(point.y-size.height/2)/state.scale};}
 function center(){
  dimensions();const geometry=model.geometry||{nodeWidth:260,nodeHeight:104,generationGap:64};
  const nearby=model.nodes.filter(node=>Math.abs(node.generation)<=2),vertical=Math.max(geometry.nodeHeight/2,...nearby.map(node=>Math.abs(node.y)+node.height/2));
  const immediate=model.nodes.filter(node=>Math.abs(node.generation)===1),span=immediate.length?Math.max(...immediate.map(node=>node.x+node.width/2))-Math.min(...immediate.map(node=>node.x-node.width/2)):geometry.nodeWidth;
  const contextWidth=Math.min(span,geometry.nodeWidth*2+(geometry.horizontalGap||36));
  state={cx:0,cy:0,scale:clampScale(Math.min(.95,Math.max(120,size.height/2-44)/vertical,size.width/(contextWidth+48)))};draw();
 }
 function zoom(factor,point={x:size.width/2,y:size.height/2}){state=zoomPedigreeViewport(state,factor,point,size);draw();}
 function fit(){dimensions();state=fitPedigreeViewport(model.bounds,size);draw();}
 function beginGesture(){
  const values=[...pointers.values()];
  if(values.length>=2){const a=values[0],b=values[1],middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale:state.scale,world:world(middle)};pan=null;suppressClick=true;for(const id of pointers.keys())element.setPointerCapture?.(id);}
  else if(values.length===1){pan={point:{...values[0]},state:{...state}};pinch=null;}
  else{pan=null;pinch=null;}
 }
 listen('pointerdown',event=>{
  if(event.button!==undefined&&event.button!==0)return;
  if(!pointers.size)suppressClick=false;
  const interactive=event.target?.closest?.('[data-family-action]');
  if(interactive&&event.pointerType!=='touch')return;
  pointers.set(event.pointerId,local(event));if(pointers.size===1&&!interactive)element.focus?.({preventScroll:true});
  if(!interactive)element.setPointerCapture?.(event.pointerId);beginGesture();
  if(!interactive||pointers.size>1){element.classList?.add('is-panning');event.preventDefault();}
 });
 listen('pointermove',event=>{
  if(!pointers.has(event.pointerId))return;const point=local(event);pointers.set(event.pointerId,point);
  if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()],middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};const scale=clampScale(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance);state={cx:pinch.world.x-(middle.x-size.width/2)/scale,cy:pinch.world.y-(middle.y-size.height/2)/scale,scale};suppressClick=true;draw();}
  else if(pan){const dx=point.x-pan.point.x,dy=point.y-pan.point.y;if(Math.hypot(dx,dy)<=4&&!suppressClick)return;suppressClick=true;element.setPointerCapture?.(event.pointerId);element.classList?.add('is-panning');state={cx:pan.state.cx-dx/pan.state.scale,cy:pan.state.cy-dy/pan.state.scale,scale:pan.state.scale};draw();}
  event.preventDefault();
 });
 const endPointer=event=>{if(!pointers.delete(event.pointerId))return;if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture?.(event.pointerId);beginGesture();if(!pointers.size)element.classList?.remove('is-panning');};
 listen('pointerup',endPointer);listen('pointercancel',endPointer);
 listen('click',event=>{if(suppressClick&&event.detail>0){suppressClick=false;event.preventDefault();event.stopPropagation();}},true);
 listen('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoom(Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.006),local(event));},{passive:false});
 listen('keydown',event=>{
  const control=event.target?.closest?.('[data-family-action]');
  if(control&&['Enter',' '].includes(event.key)){event.preventDefault();const EventClass=element.ownerDocument?.defaultView?.MouseEvent||globalThis.Event;control.dispatchEvent(new EventClass('click',{bubbles:true,cancelable:true}));return;}
  if(event.target!==element)return;
  const delta=55/state.scale;
  if(event.key==='ArrowLeft')state={...state,cx:state.cx-delta};
  else if(event.key==='ArrowRight')state={...state,cx:state.cx+delta};
  else if(event.key==='ArrowUp')state={...state,cy:state.cy-delta};
  else if(event.key==='ArrowDown')state={...state,cy:state.cy+delta};
  else if(['+','='].includes(event.key)){event.preventDefault();zoom(1.25);return;}
  else if(event.key==='-'){event.preventDefault();zoom(1/1.25);return;}
  else if(event.key==='Home'){event.preventDefault();center();return;}
  else if(event.key.toLowerCase()==='f'){event.preventDefault();fit();return;}
  else return;
  event.preventDefault();draw();
 });
 dimensions();if(initial)draw();else center();
 const Observer=element.ownerDocument?.defaultView?.ResizeObserver||globalThis.ResizeObserver;
 const observer=typeof Observer==='function'?new Observer(()=>{dimensions();draw();}):null;observer?.observe(element);
 return {zoomIn:()=>zoom(1.25),zoomOut:()=>zoom(1/1.25),fit,center,destroy(){if(disposed)return;disposed=true;observer?.disconnect();for(const remove of listeners)remove();for(const id of pointers.keys()){try{if(element.hasPointerCapture?.(id))element.releasePointerCapture?.(id);}catch{}}pointers.clear();element.classList?.remove('is-panning');}};
}
