// Only opening reads use this controller. Saves and explicit edit retries never
// enter it, so returning to a phone tab cannot replay a write.
export function createStartupReadLifecycle({cancel=()=>{},onPause=()=>{},onResume=()=>{},isVisible=()=>true,isOnline=()=>true,makeController=()=>new AbortController()}={}){
 let active=null,interrupted=false;
 function abandon(){
  const previous=active;active=null;
  if(previous){previous.controller.abort();cancel(previous.controller.signal);}
 }
 function begin(){
  abandon();interrupted=false;
  const entry={controller:makeController()};active=entry;
  return {signal:entry.controller.signal,isCurrent:()=>active===entry&&!entry.controller.signal.aborted,finish(){if(active===entry)active=null;}};
 }
 function pause(){
  if(!active)return false;
  interrupted=true;abandon();onPause();return true;
 }
 function resume(){
  if(!interrupted||!isVisible()||!isOnline())return false;
  interrupted=false;onResume();return true;
 }
 return {begin,pause,resume,reset(){interrupted=false;abandon();}};
}
