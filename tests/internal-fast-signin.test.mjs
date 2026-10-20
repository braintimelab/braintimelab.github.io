import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {guestAllows} from '../mouse-data/guest-access.js';
import {createAccessActivity} from '../mouse-data/access-activity.js';

const config = {url:'https://lab.example',colonyId:'lab',anonKey:'public'};
const signedOut = () => ({...config,configured:true,signedIn:false,role:null});
const member = email => ({...signedOut(),signedIn:true,role:'editor',guestLevel:null,exportLevel:'low',email:email||'member@example.org'});
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

async function harness({hint=null,url='https://lab.example/internal/',loadStore,verify,status= signedOut(),mountOptions={}}={}) {
  const elements=new Map(),events=new Map(),docEvents=new Map(),calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:['tools-panel','account-panel','member-account','portal-progress','retry-access','backup-viewer'].includes(id),disabled:false,type:id==='login-password'?'password':'',value:'',innerHTML:'',textContent:'',dataset:{},attributes:new Map(),listeners:new Map(),setAttribute(k,v){this.attributes.set(k,v);},addEventListener(k,v){this.listeners.set(k,v);}});return elements.get(id);};
  const document={hidden:false,getElementById:element,querySelectorAll:s=>s==='button'?[element('submit'),element('show-password'),element('retry-access')]:[],addEventListener(k,v){docEvents.set(k,v);}};
  const location=new URL(url),navigations=[];
  location.replace=value=>navigations.push(value);location.assign=value=>navigations.push(value);
  const window={location,sessionStorage:{getItem:()=>hint},addEventListener(k,v){events.set(k,v);}};
  let loads=0,current=status;
  const store={getCloudStatus:()=>({...current}),configureCloud(){current=signedOut();},async signIn(id,password){calls.push(['signIn',id,password]);current=member(id);},async verifyCloudMembership(options){calls.push(['verify']);return verify?verify(options,current):current;},async signOut(){calls.push(['signOut']);current=signedOut();},async requestPasswordReset(id){calls.push(['reset',id]);},async requestEmailLink(id){calls.push(['email',id]);}};
  const source=(await readFile(new URL('../internal/portal.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const context=vm.createContext({URL,URLSearchParams,guestAllows,createAccessActivity,setTimeout,clearTimeout,createPresence:()=>({refresh(){},clear(){},destroy(){}})});
  vm.runInContext(source,context);
  const facade=await context.mountPortal(document,window,{loadStore:()=>{loads++;return loadStore?loadStore(store):store;},loadConfig:()=>({PUBLIC_CONFIG:config,backupViewerLinkHTML:()=>''}),...mountOptions});
  return {facade,store,element,elements,events,docEvents,navigations,calls,get loads(){return loads;}};
}

test('fresh HTML exposes login before any JavaScript or session check',async()=>{
  const html=await readFile(new URL('../internal/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html.match(/<section id="sign-in-panel"[^>]*>/)[0],/\bhidden\b/);
  assert.match(html,/<p id="portal-status"[^>]*><\/p>/);
  assert.match(html,/<progress id="portal-progress"[^>]*\bhidden\b/);
  assert.match(html,/<section id="tools-panel" hidden/);
});

test('fresh visits and lifecycle events load no auth store and leave login usable',async()=>{
  const h=await harness();
  h.events.get('focus')();h.events.get('online')();h.events.get('pageshow')({persisted:true});h.docEvents.get('visibilitychange')();
  await turn();
  assert.equal(h.loads,0);assert.deepEqual(h.calls,[]);
  assert.equal(h.element('sign-in-panel').hidden,false);assert.equal(h.element('submit').disabled,false);
  assert.equal(h.element('portal-status').textContent,'');assert.equal(h.element('portal-progress').hidden,true);
  h.element('show-password').listeners.get('click')();assert.equal(h.element('login-password').type,'text');
  h.facade.dispose();
});

test('submit clears password immediately and loads auth only once before verification',async()=>{
  const loading=deferred(),verification=deferred();
  const h=await harness({loadStore:store=>loading.promise.then(()=>store),verify:()=>verification.promise});
  h.element('login-id').value='member@example.org';h.element('login-password').value='synthetic-secret';
  const submitted=h.element('sign-in-form').listeners.get('submit')({preventDefault(){}});
  assert.equal(h.element('login-password').value,'');assert.equal(h.element('login-password').type,'password');
  assert.equal(h.element('tools-panel').hidden,true);
  loading.resolve();await turn();
  assert.equal(h.loads,1);assert.equal(h.element('tools-panel').hidden,true);
  assert.deepEqual(h.calls,[['signIn','member@example.org','synthetic-secret'],['verify']]);
  verification.resolve(member());await submitted;
  assert.equal(h.element('tools-panel').hidden,false);h.facade.dispose();
});

test('a failed lazy load can be retried without exposing tools',async()=>{
  let attempts=0;
  const h=await harness({loadStore:store=>{if(++attempts===1)throw Error('synthetic load failure');return store;}});
  await h.facade.signIn('member@example.org','synthetic-secret');
  assert.equal(h.facade.getState().error,true);assert.equal(h.element('tools-panel').hidden,true);assert.equal(h.element('submit').disabled,false);
  await h.facade.signIn('member@example.org','synthetic-secret');
  assert.equal(h.loads,2);assert.equal(h.facade.getState().phase,'member');h.facade.dispose();
});

test('saved-session restoration leaves the form usable and loses to explicit sign-in',async()=>{
  const old=deferred();let first=true,cancelled;
  const h=await harness({hint:'saved-session-hint',status:member('old@example.org'),verify:(options,current)=>{if(first){first=false;cancelled=options.canCommit;return old.promise;}return current;}});
  await turn();assert.equal(h.loads,1);assert.equal(h.element('sign-in-panel').hidden,false);assert.equal(h.element('submit').disabled,false);
  await h.facade.signIn('new@example.org','synthetic-secret');
  assert.equal(cancelled(),false);assert.equal(h.facade.getState().identity,'new@example.org');
  old.resolve(member('old@example.org'));await turn();
  assert.equal(h.facade.getState().identity,'new@example.org');h.facade.dispose();
});

test('secure callback forwards directly without loading auth or exposing callback in UI',async()=>{
  const h=await harness({url:'https://lab.example/internal/#access_token=synthetic&refresh_token=synthetic-refresh&type=recovery'});
  assert.equal(h.loads,0);assert.deepEqual(h.navigations,['https://lab.example/mouse-data/#access_token=synthetic&refresh_token=synthetic-refresh&type=recovery']);
  assert(![...h.elements.values()].some(e=>e.textContent.includes('synthetic')));assert.equal(h.element('tools-panel').hidden,true);h.facade.dispose();
});

test('a timed-out module load returns control and a late result cannot override Retry',async()=>{
  const late=deferred(),timers=new Map();let sequence=0,attempts=0;
  const h=await harness({loadStore:store=>++attempts===1?late.promise.then(()=>store):store,mountOptions:{timers:{setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}}}});
  const first=h.facade.signIn('old@example.org','synthetic-secret');
  await turn();[...timers.values()][0]();await first;
  assert.equal(h.facade.getState().error,true);assert.equal(h.element('submit').disabled,false);
  await h.facade.signIn('new@example.org','synthetic-secret');
  late.resolve();await turn();
  assert.equal(h.facade.getState().identity,'new@example.org');assert.equal(h.loads,2);h.facade.dispose();
});

test('Reset and email-link actions supersede passive restoration without exposing tools',async()=>{
  for(const method of ['requestReset','sendEmailLink']){
    const old=deferred();let fence;
    const h=await harness({hint:'saved-session-hint',status:member('old@example.org'),verify:options=>{fence=options.canCommit;return old.promise;}});
    await turn();await h.facade[method]('member@example.org');
    assert.equal(fence(),false);assert.equal(h.facade.getState().phase,'signed-out');assert.equal(h.element('submit').disabled,false);
    old.resolve(member('old@example.org'));await turn();
    assert.equal(h.element('tools-panel').hidden,true);h.facade.dispose();
  }
});
