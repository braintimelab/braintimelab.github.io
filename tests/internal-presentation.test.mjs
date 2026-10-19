import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../internal/index.html',import.meta.url),'utf8');
const cards=[...html.matchAll(/<article class="tool-card"([^>]*)>([\s\S]*?)<\/article>/g)];

test('Lab tools cards have unique accessible names and concise descriptions tied to the visible heading',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
 assert.match(html,/<a class="skip-link" href="#main">/);assert.match(html,/<main id="main"[^>]*tabindex="-1"/);
 assert.match(html,/<section id="tools-panel" hidden aria-labelledby="tools-list-heading">\s*<h2 id="tools-list-heading"/);
 assert.equal(cards.length,6);
 const names=new Set();
 for(const[,attributes,body]of cards){
  const name=attributes.match(/aria-label="([^"]+)"/)?.[1],heading=body.match(/<h3>([^<]+)<\/h3>/)?.[1],descriptionId=attributes.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.equal(name,heading);assert.ok(name&&!names.has(name));names.add(name);assert.ok(descriptionId);
  const description=body.match(new RegExp(`<p class="tool-description" id="${descriptionId}">([^<]+)</p>`))?.[1];assert.ok(description&&description.length<=90,name);
 }
});

test('calculator destinations retain passive Disk badges and all analysis links stay together in category 05',()=>{
 const card=cards.find(([,attributes])=>attributes.includes('id="braintime-calculator-tool"'))?.[2];assert.ok(card);assert.match(card,/>05<\/span>/);
 for(const[id,path]of [['open-braintime-calculator','calculator'],['open-qpcr-calculator','qpcr']]){
  const entry=card.match(new RegExp(`<div class="tool-entry"><a id="${id}"[^>]*href="https://braintimedisk\\.tail933238\\.ts\\.net:10000/${path}/"[^>]*>[^<]+</a><span class="availability">BraintimeDisk</span></div>`));assert.ok(entry,id);
 }
 for(const repository of ['ImagingAnalysis','LocoBox'])assert.ok(card.includes(`https://github.com/JihwanMyung/${repository}`));
 for(const[,body]of card.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g))assert.doesNotMatch(body,/<span class="availability">/);
 assert.match(html,/<article class="tool-card" data-member-document hidden/);
 assert.match(html,/<input id="login-password"[^>]*type="password"/);assert.match(html,/<span class="availability">Cloud 1<\/span>/);
});

test('loading and Retry hooks remain native while daily shortcuts stay within verified service cards',()=>{
 const progress=html.match(/<progress\b[^>]*id="portal-progress"[^>]*>/)?.[0];assert.ok(progress);assert.doesNotMatch(progress,/\bvalue=/);assert.match(progress,/aria-label="Loading lab tools"/);
 assert.match(html,/<button id="retry-access"[^>]*type="button" hidden>Retry<\/button>/);
 for(const[tool,routes]of [['mouse-data',['cages','mice']],['reagents',['orders','inventory']]]){
  const card=cards.find(([,attributes])=>attributes.includes(`aria-label="${tool==='mouse-data'?'Mouse Data':'Reagents'}"`))?.[2];assert.ok(card);
  for(const route of routes)assert.match(card,new RegExp(`<a href="\\.\\./${tool}/#${route}" data-portal-tool="${tool}" data-route="${route}">`));
 }
 const calculator=cards.find(([,attributes])=>attributes.includes('id="braintime-calculator-tool"'))?.[2];for(const route of ['circadian','gestation','genotype'])assert.ok(calculator.includes(`/calculator/#${route}`));
 assert.doesNotMatch(html,/href="https:\/\/braintimedisk[^\"]+\/(?:#|\?open=)(?:calendar|meetings|journal-club)"/);
});
