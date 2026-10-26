const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Host callbacks rebuild context from current records. A saved working copy
 * never restores a reviewed mutation, permissions or a captured dataset. */
export function attachRegistrationMemory(container,{memory,descriptor,capture,restore,presetValues,applyPreset,continueNumbers,isCurrent,onError=()=>{},onSaveNextChange=()=>{}}={}){
 if(!container||!memory||typeof capture!=='function'||typeof restore!=='function'||typeof isCurrent!=='function')throw new Error('Registration draft controls need a current editor.');
 const document=container.ownerDocument,panel=document.createElement('fieldset');panel.className='field wide registration-memory';
 panel.innerHTML=`<legend>Saved registration work</legend><p class="small muted">Working copies stay for 30 days in this browser for this account and colony. Presets keep shared defaults; individual genotype, parents, dates and SIDs are excluded. Recovered work must be reviewed again before saving.</p><p role="status" class="small" data-memory-status></p><div class="settings-actions" data-memory-recovery><button type="button" class="button secondary" data-memory-action="restore">Restore saved draft</button><button type="button" class="button secondary" data-memory-action="fresh">Start fresh</button></div><div class="form-grid"><div class="field"><label for="registration-memory-preset">Registration preset</label><select id="registration-memory-preset" data-memory-preset></select></div><div class="field"><label for="registration-memory-name">Preset name</label><input id="registration-memory-name" maxlength="80" placeholder="For example, FB line / SPF room"></div></div><div class="settings-actions"><button type="button" class="button secondary" data-memory-action="apply">Apply preset</button><button type="button" class="button secondary" data-memory-action="preset-save">Save these defaults</button><button type="button" class="button secondary" data-memory-action="preset-remove">Remove preset</button><button type="button" class="button secondary" data-memory-action="next-number">Continue physical tag numbers</button></div><label class="checkbox-label"><input type="checkbox" data-memory-save-next> Save and add another batch with shared defaults (new counts, genotype and dates are reviewed afresh)</label>`;
 container.prepend(panel);
 const status=panel.querySelector('[data-memory-status]'),recovery=panel.querySelector('[data-memory-recovery]'),select=panel.querySelector('[data-memory-preset]'),name=panel.querySelector('#registration-memory-name');
 let disposed=false,pendingRecovery=Boolean(memory.getDraft(descriptor)),timer=null,dirty=false,saveNext=false;
 const current=()=>!disposed&&isCurrent()===true&&panel.isConnected!==false;
 const message=value=>{if(current())status.textContent=value;};
 function report(error){if(!current())return;message(error.message||String(error));onError(error);}
 function drawPresets(selected=select.value){const presets=memory.listPresets();select.innerHTML='<option value="">Choose a saved preset</option>'+presets.map(row=>`<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('');if(presets.some(row=>row.name===selected))select.value=selected;}
 function flush(){
  if(timer!==null){clearTimeout(timer);timer=null;}
  if(!current()||pendingRecovery||!dirty)return false;
  try{memory.saveDraft(capture());message('Draft saved in this browser.');return true;}catch(error){report(error);return false;}
 }
 function changed(event){if(!current()||panel.contains(event.target))return;dirty=true;if(pendingRecovery){message('A saved draft is available. Choose Restore saved draft or Start fresh before this new work replaces it.');return;}if(timer!==null)clearTimeout(timer);timer=setTimeout(flush,200);}
 async function restoreSaved(){const value=memory.getDraft(descriptor);if(!value)throw new Error('The saved draft is no longer available.');await restore(value);if(!current())return;pendingRecovery=false;recovery.hidden=true;dirty=true;flush();message('Draft restored. Review all details and assigned SIDs before saving.');}
 const form=container.closest('form')||container;form.addEventListener('input',changed);form.addEventListener('change',changed);
 panel.addEventListener('change',event=>{if(event.target.matches('[data-memory-save-next]')){saveNext=event.target.checked;onSaveNextChange(saveNext);}});
 panel.addEventListener('click',async event=>{
  const action=event.target.closest('[data-memory-action]')?.dataset.memoryAction;if(!action||!current())return;event.preventDefault();event.stopPropagation();
  try{
   if(action==='restore'){await restoreSaved();}
   else if(action==='fresh'){memory.removeDraft(descriptor);pendingRecovery=false;recovery.hidden=true;dirty=true;flush();message('Previous saved copy discarded. Current form kept as a fresh draft.');}
   else if(action==='preset-save'){if(typeof presetValues!=='function')throw new Error('Presets are not available for this editor.');const value=presetValues();const preset=memory.savePreset({...value,name:name.value.trim()});drawPresets(preset.name);message('Preset saved. Individual genotype, parents, dates and SIDs are excluded.');}
   else if(action==='preset-remove'){if(!select.value)throw new Error('Choose the preset to remove.');memory.removePreset(select.value);drawPresets('');message('Preset removed from this browser.');}
   else if(action==='apply'){const preset=memory.listPresets().find(row=>row.name===select.value);if(!preset)throw new Error('Choose a saved preset.');if(typeof applyPreset!=='function')throw new Error('Presets are not available for this editor.');await applyPreset(preset);if(!current())return;dirty=true;flush();message('Defaults applied. Review the current cage, protocol and numbering before saving.');}
   else if(action==='next-number'){if(typeof continueNumbers!=='function')throw new Error('Choose separate physical tag numbering first.');const next=await continueNumbers();if(!current())return;dirty=true;flush();message(`Next physical tag number: ${next}. Review the whole batch for duplicate tags.`);}
  }catch(error){report(error);}
 });
 drawPresets();recovery.hidden=!pendingRecovery;message(pendingRecovery?'An unfinished draft is available for this registration.':'New edits will be kept automatically in this browser.');
 return Object.freeze({
  flush,restoreSaved,markChanged(){dirty=true;return flush();},
  pendingRecovery:()=>pendingRecovery,saveAndAddAnother:()=>saveNext,
  saved(){if(!current())return false;dirty=false;try{memory.removeDraft(descriptor);message('Batch saved.');return true;}catch(error){report(new Error('The batch was saved, but its browser working copy could not be cleared. Check existing records before recovering it.'));return false;}},
  dispose(){if(disposed)return;flush();disposed=true;if(timer!==null)clearTimeout(timer);form.removeEventListener('input',changed);form.removeEventListener('change',changed);panel.remove();},
 });
}
