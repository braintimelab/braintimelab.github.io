import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code = await readFile(new URL('../assets/join.js',import.meta.url),'utf8');
function setup(reduced=false) {
  const element=()=>({events:{},attrs:{},hidden:true,value:'0',textContent:'',
    addEventListener(type,fn){this.events[type]=fn;},setAttribute(k,v){this.attrs[k]=v;}});
  const names=['.motion-control','#elapsed-days','#elapsed-label','#phase-summary','#rhythm-play','#rhythm-reset','.rhythm-controls'];
  const nodes=Object.fromEntries(names.map(n=>[n,element()]));
  const clocks=['slow','reference','fast'].map(name=>({...element(),dataset:{clock:name}}));
  const classes=new Set();
  const page={querySelector:s=>nodes[s],querySelectorAll:()=>clocks,classList:{toggle(c,v){v?classes.add(c):classes.delete(c);}}};
  const doc={...element(),hidden:false,querySelector:()=>page};
  const media={matches:reduced,addEventListener(){}};
  const frames=new Map();let id=0;
  vm.runInNewContext(code,{document:doc,window:{matchMedia:()=>media},performance:{now:()=>0},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i)});
  return {nodes,clocks,classes,doc,frames};
}
test('reduced-motion starts static and supports deliberate opt-in and pause',()=>{
  const f=setup(true);
  assert(f.classes.has('motion-paused'));assert(!f.classes.has('motion-enabled'));
  assert.equal(f.frames.size,0);
  f.nodes['.motion-control'].events.click();
  assert(f.classes.has('motion-enabled'));assert(!f.classes.has('motion-paused'));
  f.nodes['.motion-control'].events.click();
  assert(!f.classes.has('motion-enabled'));
});
test('manual time control preserves the reference and computes slower/faster phase accurately',()=>{
  const f=setup();f.nodes['#elapsed-days'].value='10';f.nodes['#elapsed-days'].events.input();
  assert.equal(f.clocks[1].attrs.transform,'rotate(3600 80 80)');
  assert.equal(f.clocks[0].attrs.transform,'rotate(3456 80 80)');
  assert.match(f.nodes['#phase-summary'].textContent,/lags by 9.6 hours; the faster clock leads by 10.4 hours/);
  f.nodes['#rhythm-reset'].events.click();
  assert(f.clocks.every(c=>c.attrs.transform==='rotate(0 80 80)'));
});
test('playback is opt-in and stops when the page becomes hidden',()=>{
  const f=setup();assert.equal(f.frames.size,0);
  f.nodes['#rhythm-play'].events.click();assert.equal(f.frames.size,1);
  const [id,callback]=[...f.frames][0];f.frames.delete(id);callback(100);
  assert.notEqual(f.clocks[1].attrs.transform,'rotate(0 80 80)');
  f.doc.hidden=true;f.doc.events.visibilitychange();
  assert.equal(f.frames.size,0);assert.equal(f.nodes['#rhythm-play'].attrs['aria-pressed'],'false');
});
