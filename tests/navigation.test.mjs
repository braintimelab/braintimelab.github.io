import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../assets/site.js', import.meta.url), 'utf8');
function setup(small = true) {
  let doc;
  const element = name => {
    const attrs = new Map(), classes = new Set(), events = new Map();
    return {name, attrs, events, children: [],
      classList: {add: c => classes.add(c), contains: c => classes.has(c), toggle(c, yes) {yes ? classes.add(c) : classes.delete(c);}},
      setAttribute: (k,v) => attrs.set(k,v), getAttribute: k => attrs.get(k),
      addEventListener: (type, fn) => events.set(type, fn),
      contains(target) {return target === this || this.children.includes(target);},
      focus() {doc.activeElement = this; doc.events.get('focusin')?.({target: this});},
      querySelectorAll: () => [], querySelector: () => null, closest: () => null,
      emit(type, values = {}) {const event = {target: this, prevented: false, preventDefault(){this.prevented = true;}, ...values}; events.get(type)?.(event); return event;}
    };
  };
  doc = element('document');
  const button = element('button'), nav = element('nav'), header = element('header'), icon = element('icon');
  const links = ['Projects','Members','Publications','Lectures','Resources','Why join','Lab tools'].map(element);
  nav.children = links;
  nav.querySelectorAll = () => links;
  button.closest = () => header;
  button.querySelector = () => icon;
  button.children = [icon];
  links.forEach(link => {link.closest = selector => selector === 'a' ? link : null;});
  doc.querySelector = selector => selector === '.menu-button' ? button : nav;
  const media = {matches: small, addEventListener(type, fn) {this.change = fn;}};
  vm.runInNewContext(code, {document: doc, window: {matchMedia: query => {assert.equal(query,'(max-width: 1100px)'); return media;}}});
  return {doc,button,nav,header,icon,links,media,
    resize(small) {media.matches = small; media.change();},
    open: () => button.getAttribute('aria-expanded') === 'true'};
}

test('touch/click opens and closes the compact navigation with accurate accessible state', () => {
  const f = setup();
  assert(!f.open());
  f.button.emit('click');
  assert(f.open());
  assert(f.nav.classList.contains('is-open'));
  assert.equal(f.button.getAttribute('aria-label'),'Close main navigation');
  assert.equal(f.icon.textContent,'×');
  f.button.emit('click');
  assert(!f.open());
  assert.equal(f.icon.textContent,'☰');
});

test('arrow keys enter the menu, wrap through links, and support Home/End', () => {
  const f = setup();
  assert(f.button.emit('keydown',{key:'ArrowDown'}).prevented);
  assert.equal(f.doc.activeElement,f.links[0]);
  f.nav.emit('keydown',{key:'ArrowUp'});
  assert.equal(f.doc.activeElement,f.links.at(-1));
  f.nav.emit('keydown',{key:'ArrowDown'});
  assert.equal(f.doc.activeElement,f.links[0]);
  f.nav.emit('keydown',{key:'End'});
  assert.equal(f.doc.activeElement,f.links.at(-1));
  f.nav.emit('keydown',{key:'Home'});
  assert.equal(f.doc.activeElement,f.links[0]);
});

test('Escape closes navigation and restores focus to its trigger', () => {
  const f = setup();
  f.button.emit('keydown',{key:'ArrowUp'});
  assert.equal(f.doc.activeElement,f.links.at(-1));
  assert(f.doc.emit('keydown',{key:'Escape'}).prevented);
  assert(!f.open());
  assert.equal(f.doc.activeElement,f.button);
});

test('Tab remains native, and focusing or touching outside closes the dropdown without stealing focus', () => {
  const f = setup();
  f.button.emit('keydown',{key:'ArrowDown'});
  assert(!f.nav.emit('keydown',{key:'Tab'}).prevented);
  const outside = {name:'main link'};
  f.doc.activeElement = outside;
  f.doc.emit('focusin',{target:outside});
  assert(!f.open());
  assert.equal(f.doc.activeElement,outside);
  f.button.emit('click');
  f.doc.emit('pointerdown',{target:outside});
  assert(!f.open());
});

test('menu link selection closes the dropdown and modified arrow keys retain browser behavior', () => {
  const f = setup();
  f.button.emit('keydown',{key:'ArrowDown'});
  assert(!f.nav.emit('keydown',{key:'ArrowDown',ctrlKey:true}).prevented);
  assert.equal(f.doc.activeElement,f.links[0]);
  f.nav.emit('click',{target:f.links[0]});
  assert(!f.open());
});

test('resizing clears stale expanded state and prevents hidden focused links on mobile', () => {
  const f = setup();
  f.button.emit('keydown',{key:'ArrowDown'});
  f.resize(false);
  assert(!f.open());
  assert.equal(f.doc.activeElement,f.links[0]);
  assert(!f.button.emit('keydown',{key:'ArrowDown'}).prevented);
  f.resize(true);
  assert.equal(f.doc.activeElement,f.button);
  assert(!f.open());
});

test('internal footer links home and the removed introduction stays absent', async () => {
  const html = await readFile(new URL('../internal/index.html',import.meta.url),'utf8');
  assert(!html.includes('A shared workspace for the everyday work of the lab.'));
  assert.match(html,/<footer[^>]*><a href="\.\.\/">Braintime Laboratory<\/a>/);
});
