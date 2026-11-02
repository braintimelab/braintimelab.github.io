import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../internal/index.html',import.meta.url),'utf8');
const cards=[...html.matchAll(/<article class="tool-card"([^>]*)>([\s\S]*?)<\/article>/g)];
const core=html.match(/<div class="tool-grid core-apps"[^>]*>([\s\S]*?)\n      <\/div>/)?.[1];
const primary=[...core.matchAll(/<article class="tool-card"([^>]*)>([\s\S]*?)<\/article>/g)];

test('Workspace presents exactly four central apps with accessible names and descriptions',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
 assert.match(html,/<title>Braintime Workspace · Braintime Laboratory<\/title>/);
 assert.match(html,/<h1 id="tools-heading">Braintime Workspace<\/h1>/);
 assert.match(html,/<a class="skip-link" href="#main">/);assert.match(html,/<main id="main"[^>]*tabindex="-1"/);
 assert.match(html,/<section id="tools-panel" hidden aria-labelledby="tools-list-heading">/);
 assert.deepEqual(primary.map(([,a])=>a.match(/aria-label="([^"]+)"/)[1]),['Braintime Boards','Mouse Data','Reagents','Primers']);
 assert.equal(cards.length,6);
 const names=new Set();
 for(const[,attributes,body]of cards){
  const name=attributes.match(/aria-label="([^"]+)"/)?.[1],heading=body.match(/<h3>([^<]+)<\/h3>/)?.[1],descriptionId=attributes.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.equal(name,heading);assert.ok(name&&!names.has(name));names.add(name);assert.ok(descriptionId);
  const description=body.match(new RegExp(`<p class="tool-description" id="${descriptionId}">([^<]+)</p>`))?.[1];assert.ok(description&&description.length<=90,name);
 }
});

test('Primers is independent and precedes supporting calculators; qPCR stays with Primers',()=>{
 const primer=primary.find(([,a])=>a.includes('id="braintime-primers-tool"'))?.[2];assert.ok(primer);assert.match(primer,/>03<\/span>/);
 assert.match(primer,/id="open-braintime-primers"[^>]*href="https:\/\/braintimedisk\.tail933238\.ts\.net:10000\/primers\/"/);
 assert.ok(primer.indexOf('/primers/#catalog')<primer.indexOf('/primers/#design'));
 assert.match(primer,/id="open-qpcr-calculator"[^>]*href="https:\/\/braintimedisk\.tail933238\.ts\.net:10000\/qpcr\/"/);
 const calc=cards.find(([,a])=>a.includes('id="braintime-calculator-tool"'))?.[2];assert.ok(calc);assert.match(calc,/>04<\/span>/);assert.doesNotMatch(calc,/\/primers\/|open-qpcr-calculator/);
 assert.ok(html.indexOf('id="braintime-primers-tool"')<html.indexOf('id="support-heading"'));
 assert.ok(html.indexOf('id="support-heading"')<html.indexOf('id="braintime-calculator-tool"'));
 for(const route of ['circadian','gestation','genotype'])assert.ok(calc.includes(`/calculator/#${route}`));
 for(const repository of ['ImagingAnalysis','LocoBox'])assert.ok(calc.includes(`https://github.com/JihwanMyung/${repository}`));
 assert.doesNotMatch(primer,/data-portal-tool=/,'native Primers must not be dispatched through the Reagents handler');
});

test('Disk is below Experiment sheet inside Boards and is not a standalone card',()=>{
 const board=primary[0][2];assert.ok(board.indexOf('Experiment sheet')<board.indexOf('https://braintimedisk.tw4.quickconnect.to'));
 assert.match(board,/href="https:\/\/braintimedisk\.tail933238\.ts\.net:10000\/"/);
 assert.match(board,/data-member-document hidden href="https:\/\/docs\.google\.com\/spreadsheets/);
 assert.ok(!cards.some(([,a])=>a.includes('aria-label="BraintimeDisk"')));
 assert.equal((html.match(/href="https:\/\/braintimedisk.tw4.quickconnect.to"/g)||[]).length,1);
 assert.doesNotMatch(board,/data-portal-tool=/,'native Boards must not be dispatched through the Reagents handler');
});

test('protocol documents remain member-gated and secondary; shortcuts preserve permission checks',()=>{
 const protocol=cards.find(([,a])=>a.includes('aria-label="Protocols &amp; lab notes"'));assert.ok(protocol);assert.match(protocol[1],/data-member-document hidden/);
 assert.match(protocol[2],/<details class="protocol-library"><summary>Protocols &amp; references<\/summary>/);
 assert.match(html,/<input id="login-password"[^>]*type="password"/);
 assert.match(html,/<button id="retry-access"[^>]*type="button" hidden>Retry<\/button>/);
 for(const[tool,routes]of [['mouse-data',['cages','mice']],['reagents',['orders','inventory']]]){
  const card=primary.find(([,a])=>a.includes(`id="${tool==='mouse-data'?'mouse-data-tool':'reagents-tool'}"`))?.[2];assert.ok(card);
  for(const route of routes)assert.match(card,new RegExp(`<a href="\\.\\./${tool}/#${route}" data-portal-tool="${tool}" data-route="${route}">`));
 }
 assert.doesNotMatch(html,/https:\/\/braintimemain\./,'this presentation update must not activate Main');
});
test('Primers sheet follows its shortcuts and uses the same initially-hidden member-document gate and Sheets link style',()=>{
 const primer=primary.find(([,a])=>a.includes('id="braintime-primers-tool"'))[2],sheet=primer.match(/<a class="tool-link" data-member-document hidden href="https:\/\/docs\.google\.com\/spreadsheets\/d\/1KVkAF8M9D8H1Mu_oidcavflEZY0pivAN2J2qBUlGlxo\/edit\?gid=33983260#gid=33983260"[^>]*>[\s\S]*?<\/a>/)?.[0];assert.ok(sheet);assert.match(sheet,/target="_blank" rel="noopener noreferrer"/);assert.match(sheet,/<img class="google-file-icon" src="\.\.\/assets\/icons\/google\/sheets\.svg" width="18" height="18" alt="Google Sheets">Primers sheet/);assert.match(sheet,/opens in a new tab/);assert.ok(primer.indexOf('Open Primers')<primer.indexOf(sheet));assert.ok(primer.indexOf(sheet)>primer.indexOf('class="tool-shortcuts"'));assert.equal((html.match(/1KVkAF8M9D8H1Mu_oidcavflEZY0pivAN2J2qBUlGlxo/g)||[]).length,1);
});
