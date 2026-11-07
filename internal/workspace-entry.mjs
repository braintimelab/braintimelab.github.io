const MAX_AGE=60_000;
const statusFormat='braintime-public-service-status-v2';
const deployment='61af3893-f1cb-417c-8c7c-2b7cfb0a89fd';
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function mainReady(status,now=Date.now()){
 const timestamp=Date.parse(status?.observedAt);
 return status?.format===statusFormat&&status.cloudId==='cloud1'&&status.mode==='primary'&&
   status.deploymentId===deployment&&status.service==='ready'&&status.authReady===true&&status.dataReady===true&&
   status.writable===true&&Number.isFinite(timestamp)&&Math.abs(timestamp-now)<=MAX_AGE&&
   digest(status.captureSha256)&&typeof status.generation==='string'&&status.generation.length>7&&
   ['identity','projection','service'].every(key=>digest(status.acceptances?.[key]));
}

export async function openMain({doc,location,fetchImpl,timeout=4000,now=Date.now}){
 const nav=doc.querySelector('[data-workspace-servers]'),main=nav?.querySelector('[data-main-entry]');
 const status=doc.getElementById('workspace-entry-status');
 if(!main||!status||new URLSearchParams(location.search).has('choose'))return;
 const controller=new AbortController();
 let timer;
 const manual=()=>{controller.abort();status.textContent='Recovery opens the read-only backup.';}
 nav.addEventListener('click',manual,{once:true});
 nav.addEventListener('focusin',manual,{once:true});
 status.textContent='Checking Main. You can also open Recovery.';
 try{
  const ready=await Promise.race([
   (async()=>{
    const url=new URL('status',main.href),response=await fetchImpl(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
    return response.ok&&mainReady(await response.json(),now());
   })(),
   new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeout);}),
  ]);
  if(controller.signal.aborted)return;
  if(ready){location.replace(main.href);return;}
  status.textContent='Main is unavailable. Open Recovery to use the read-only backup.';
 }catch{
  if(!controller.signal.aborted)status.textContent='Main is unavailable. Open Recovery to use the read-only backup.';
 }finally{
  clearTimeout(timer);controller.abort();
  nav.removeEventListener('click',manual);nav.removeEventListener('focusin',manual);
 }
}
if(typeof document!=='undefined')void openMain({doc:document,location:window.location,fetchImpl:window.fetch.bind(window)});
