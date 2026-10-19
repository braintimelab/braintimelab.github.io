import {GUEST_LEVELS,GUEST_PERMISSION_KEYS,GUEST_LOCKED_FEATURES,GUEST_AVAILABILITY_MODES,guestPermissions,guestDefaults,guestAvailabilityDraft,guestAvailabilityInput,guestAvailabilityLabel} from './guest-access.js?v=153';
/* Owner edits; managers have a filtered read-only directory. Authorization is enforced by the server for every request. */
import {MANAGER_PERMISSION_LABELS,defaultManagerPermissions,normalizeManagerPermissions} from './permissions.js?v=100';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const mounts=new WeakMap();
const editableRoles=new Set(['viewer','editor','manager']);
const exportLevels=new Set(['low','mid1','mid2','high','max']);
const savedLevels=new Set([...exportLevels,'mid']);
const exportName=level=>({low:'Low (past 3 years)',mid:'Mid (legacy, past 3 years)',mid1:'Mid1 (past 3 years, 3 GB personal space)',mid2:'Mid2 (past 6 years, 1 GB personal space)',high:'High (past 6 years)',max:'Max (full history)'}[level]||'Low (past 3 years)');
const savedExportLevel=user=>user.role==='owner'?'max':savedLevels.has(user.export_level)?user.export_level:'low';
const exportOptions=(selected,legacy=false)=>[...exportLevels,...(legacy?['mid']:[])].map(level=>`<option value="${level}"${level===selected?' selected':''}>${exportName(level)}</option>`).join('');
const validUserLevel=(user,level)=>exportLevels.has(level)||level==='mid'&&savedExportLevel(user)==='mid';
const accessName=role=>({owner:'Owner',viewer:'Read only',editor:'Read & write',manager:'Manager'}[role]||'Unavailable');
const statusName=status=>({active:'Active',invited:'Invited',disabled:'Inactive',unavailable:'Unavailable'}[status]||'Unknown');
const errorMessage=error=>error?.message||'The request could not be completed. Try again.';

export async function renderUserManagement(container,hooks) {
  const state={users:[],email:'',inviteRole:'viewer',inviteExportLevel:'low',roles:new Map(),levels:new Map(),permissions:new Map(),guestLevels:new Map(),guestOverrides:new Map(),guestAvailability:new Map(),invitePermissions:defaultManagerPermissions(),loading:true,busy:false,authorized:false,readOnly:false,error:'',notice:''};
  mounts.set(container,state);
  const current=()=>mounts.get(container)===state;
  const protectedUser=user=>state.readOnly||user.role==='owner'||!editableRoles.has(user.role)||user.status==='unavailable';
  const request=(action,payload={})=>hooks.manageColonyUsers(action,payload);
  const guestLevel=user=>state.guestLevels.has(user.user_id)?state.guestLevels.get(user.user_id):user.guest_level||null;
  const guestOverrides=user=>state.guestOverrides.get(user.user_id)||user.guest_permissions||{};
  const availabilityDraft=user=>state.guestAvailability.get(user.user_id)||guestAvailabilityDraft(user);
  const guestChanged=user=>guestLevel(user)!==(user.guest_level||null)||JSON.stringify(guestOverrides(user))!==JSON.stringify(user.guest_permissions||{})||Boolean(guestLevel(user)&&state.guestAvailability.has(user.user_id));
  function availabilityFields(user){const id=escapeHTML(user.user_id),draft=availabilityDraft(user);return `<fieldset class="compact-details"><legend>Availability</legend><div class="form-grid"><label>Availability<select data-user-guest-availability="mode" data-user-id="${id}"${disabled()}>${Object.entries(GUEST_AVAILABILITY_MODES).map(([key,label])=>`<option value="${key}"${draft.mode===key?' selected':''}>${label}</option>`).join('')}</select></label>${draft.mode==='range'?`<label>From<input type="date" min="1900-01-01" max="9999-12-31" data-user-guest-availability="startsOn" data-user-id="${id}" value="${escapeHTML(draft.startsOn)}" required${disabled()}></label>`:''}${draft.mode!=='unspecified'?`<label>Until${draft.mode==='range'?' (optional)':''}<input type="date" min="1900-01-01" max="9999-12-31" data-user-guest-availability="endsOn" data-user-id="${id}" value="${escapeHTML(draft.endsOn)}"${draft.mode==='until'?' required':''}${disabled()}></label>`:''}</div><p class="small muted">${escapeHTML(guestAvailabilityLabel(user))}. Dates use Taipei time, including the end date. On expiry, access is disabled and the account moves to Historical. Changing dates does not reactivate it.</p></fieldset>`;}
  function guestFields(user){const id=escapeHTML(user.user_id),level=guestLevel(user),resolved=guestPermissions(level,guestOverrides(user));return `<details${guestChanged(user)?' open':''}><summary>${escapeHTML(GUEST_LEVELS[user.guest_level]||'Guest access')}</summary><label>Guest level<select data-user-guest-level="${id}"${disabled()}><option value="">Not a guest</option>${Object.entries(GUEST_LEVELS).map(([key,label])=>`<option value="${key}"${key===level?' selected':''}>${label}</option>`).join('')}</select></label>${level?availabilityFields(user)+['notes','mouse','reagents'].map(app=>`<details><summary>${app==='notes'?'Lab Notes':app==='mouse'?'Mouse Data':'Reagents'}</summary>${GUEST_PERMISSION_KEYS.filter(k=>k.startsWith(app+'.')).map(key=>`<label style="display:block"><input type="checkbox" data-user-guest-permission="${key}" data-user-id="${id}"${resolved[key]?' checked':''}${disabled()||(GUEST_LOCKED_FEATURES.includes(key)?' disabled':'')}> ${escapeHTML(key.slice(app.length+1).replaceAll('_',' ').replaceAll('.',' · '))}</label>`).join('')}</details>`).join(''):''}<button type="button" class="button secondary" data-user-action="save-guest" data-user-id="${id}"${disabled()||(!guestChanged(user)?' disabled':'')}>Save guest access</button></details>`;}
  const disabled=()=>state.loading||state.busy?' disabled':'';

  const savedPermissions=user=>user.role==='manager'?normalizeManagerPermissions(user.permissions):defaultManagerPermissions();
  const selectedPermissions=user=>state.permissions.get(user.user_id)||savedPermissions(user);
  const permissionChanged=user=>JSON.stringify(selectedPermissions(user))!==JSON.stringify(savedPermissions(user));
  function permissionFields(permissions,userId=null){return `<fieldset class="compact-details"><legend>Manager permissions</legend><div class="exp-methods">${Object.entries(MANAGER_PERMISSION_LABELS).map(([key,label])=>`<label><input type="checkbox" ${userId?`data-user-permission="${key}" data-user-id="${escapeHTML(userId)}"`:`data-invite-permission="${key}" name="invite-permission-${key}"`}${permissions[key]?' checked':''}${disabled()}> ${escapeHTML(label)}</label>`).join('')}</div><p class="small muted">User administration, the historical roster and permission settings remain owner-only.</p></fieldset>`}

  function userRow(user) {
    const id=escapeHTML(user.user_id),role=state.roles.get(user.user_id)||user.role,level=state.levels.get(user.user_id)||savedExportLevel(user),locked=protectedUser(user),pending=role!==user.role||level!==savedExportLevel(user)||(role==='manager'&&permissionChanged(user));
    const access=locked?`<span class="badge">${escapeHTML(accessName(user.role))}</span>`:`<select aria-label="Access for ${escapeHTML(user.email||user.name||'user')}" data-user-role="${id}"${disabled()||(user.guest_level?' disabled':'')}><option value="viewer"${role==='viewer'?' selected':''}>Read only</option><option value="editor"${role==='editor'?' selected':''}>Read &amp; write</option><option value="manager"${role==='manager'?' selected':''}>Manager</option></select>${role==='manager'?permissionFields(selectedPermissions(user),user.user_id):''}`;
    const guest=locked?'':guestFields(user);
    const exportAccess=locked||user.guest_level?`<span class="badge">${user.role==='owner'?'Max':user.guest_level?'Guest - Past 1 year':exportName(level)}</span>`:`<select aria-label="Export level for ${escapeHTML(user.email||user.name||'user')}" data-user-export-level="${id}"${disabled()}>${exportOptions(level,savedExportLevel(user)==='mid')}</select>`;
    const actions=locked?`<span class="small muted">${state.readOnly?'Read only':user.role==='owner'?'Protected owner':'Unavailable'}</span>`:`<div class="settings-actions"><button class="button secondary" data-user-action="save-access" data-user-id="${id}"${disabled()||(!pending?' disabled':'')}>Save access</button><button class="button secondary" data-user-action="${user.active?'deactivate':'reactivate'}" data-user-id="${id}"${disabled()}>${user.active?'Deactivate':'Reactivate'}</button></div>`;
    return `<tr><td>${escapeHTML(user.name||'Not set')}</td><td>${escapeHTML(user.email||'Unavailable')}</td><td>${access}${guest}</td><td>${exportAccess}</td><td><span class="badge${user.active?'':' amber'}">${escapeHTML(statusName(user.status))}</span></td>${state.readOnly?'':`<td>${actions}</td>`}</tr>`;
  }

  function paint() {
    if(!current())return;
    container.innerHTML=`<section class="panel user-management" aria-labelledby="user-management-title"><div class="panel-head"><h2 id="user-management-title">User management</h2><button class="button secondary" data-user-action="refresh"${disabled()}>Refresh</button></div><div class="dialog-content"><div class="alert error" role="alert"${state.error?'':' hidden'}>${escapeHTML(state.error)}</div><div class="banner" role="status"${state.notice?'':' hidden'}>${escapeHTML(state.notice)}</div>${state.authorized?`<form data-user-invite><div class="form-grid"><div class="field"><label for="user-admin-email">Email address</label><input id="user-admin-email" name="invite-email" type="email" autocomplete="email" required maxlength="254" placeholder="name@example.org" value="${escapeHTML(state.email)}"${disabled()}></div><div class="field"><label for="user-admin-invite-role">Access</label><select id="user-admin-invite-role" name="invite-role"${disabled()}><option value="viewer"${state.inviteRole==='viewer'?' selected':''}>Read only</option><option value="editor"${state.inviteRole==='editor'?' selected':''}>Read &amp; write</option><option value="manager"${state.inviteRole==='manager'?' selected':''}>Manager</option></select></div><div class="field"><label for="user-admin-invite-export-level">Export level</label><select id="user-admin-invite-export-level" name="invite-export-level"${disabled()}>${exportOptions(state.inviteExportLevel)}</select></div></div>${state.inviteRole==='manager'?permissionFields(state.invitePermissions):''}<details class="compact-details"><summary>About export levels</summary><p class="small muted">Export level sets the available history window. Read/write access controls editing separately. New users start at Low; the owner retains Max.</p></details><div class="settings-actions"><button type="submit" class="button primary"${disabled()}>Invite user</button></div></form>`:''}</div><div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Export level</th><th>Status</th>${state.readOnly?'':'<th>Manage</th>'}</tr></thead><tbody>${state.users.map(userRow).join('')}</tbody></table>${state.loading?'<div class="empty" role="status">Loading users…</div>':!state.users.length?'<div class="empty">No users to display.</div>':''}</div></section>`;
  }

  async function reload() {
    state.authorized=false;state.users=[];paint();
    const result=await request('list');
    if(!result||!Array.isArray(result.users)||!['owner','manager'].includes(result.viewer?.role)||typeof result.viewer?.user_id!=='string'||!result.viewer.user_id)throw new Error('The user list could not be read. Refresh to try again.');
    state.readOnly=result.viewer.role==='manager';state.users=result.users.filter(user=>!state.readOnly||user.role!=='owner'&&user.user_id!==result.viewer.user_id);state.authorized=!state.readOnly;
    state.roles.clear();
    state.levels.clear();
    state.permissions.clear();state.guestLevels.clear();state.guestOverrides.clear();state.guestAvailability.clear();
  }

  async function refresh() {
    if(state.busy)return;
    state.loading=true;state.error='';paint();
    try {await reload()}catch(error){state.error=errorMessage(error)}
    finally {state.loading=false;paint()}
  }

  async function change(action,payload) {
    if(state.busy||state.loading)return;
    state.busy=true;state.error='';state.notice='';paint();
    let saved=false;
    try {
      const result=await request(action,payload);
      saved=true;
      state.notice=result?.message||(action==='invite'?(result?.email_sent?'Invitation sent.':'Access granted. No invitation email was sent.'):'Access updated.');
      if(action==='invite'){state.email='';state.inviteExportLevel='low';state.invitePermissions=defaultManagerPermissions()}
      await reload();
    } catch(error) {
      if(String(error?.code)==='42501'||Number(error?.status)===403){state.authorized=false;state.users=[]}
      state.error=(saved?'The change was saved, but the user list could not refresh. ':'')+errorMessage(error);
      if(!saved&&(error?.invitationSent===true||error?.invitation_sent===true))state.error+=' An invitation email was sent. Refresh the list before retrying.';
    } finally {state.busy=false;paint()}
  }

  function captureAvailability(target){const key=target.dataset?.userGuestAvailability;if(!['mode','startsOn','endsOn'].includes(key)||!current()||!state.authorized||state.busy||state.loading)return false;const user=state.users.find(row=>row.user_id===target.dataset.userId);if(!user||protectedUser(user)||!guestLevel(user)||key==='mode'&&!Object.hasOwn(GUEST_AVAILABILITY_MODES,target.value))return false;state.guestAvailability.set(user.user_id,{...availabilityDraft(user),[key]:target.value});return true;}
  container.oninput=event=>{if(captureAvailability(event.target))return;if(event.target.id==='user-admin-email')state.email=event.target.value};
  container.onchange=event=>{
    const target=event.target;
    if(captureAvailability(target)){paint();return;}
    if(target.dataset?.userGuestLevel){const user=state.users.find(u=>u.user_id===target.dataset.userGuestLevel);if(user&&!protectedUser(user)){state.guestLevels.set(user.user_id,target.value||null);state.guestOverrides.set(user.user_id,{});paint();}return;}
    if(target.dataset?.userGuestPermission){const user=state.users.find(u=>u.user_id===target.dataset.userId),key=target.dataset.userGuestPermission;if(user&&!protectedUser(user)&&GUEST_PERMISSION_KEYS.includes(key)){state.guestOverrides.set(user.user_id,{...guestOverrides(user),[key]:target.checked===true});paint();}return;}
    if(target.id==='user-admin-email')state.email=target.value;
    if(target.id==='user-admin-invite-role'&&editableRoles.has(target.value)){state.inviteRole=target.value;paint()}
    if(target.dataset?.invitePermission&&Object.hasOwn(MANAGER_PERMISSION_LABELS,target.dataset.invitePermission)&&state.inviteRole==='manager')state.invitePermissions[target.dataset.invitePermission]=target.checked===true;
    if(target.dataset?.userPermission&&Object.hasOwn(MANAGER_PERMISSION_LABELS,target.dataset.userPermission)){const user=state.users.find(row=>row.user_id===target.dataset.userId);if(user&&!protectedUser(user)&&(state.roles.get(user.user_id)||user.role)==='manager'){state.permissions.set(user.user_id,{...selectedPermissions(user),[target.dataset.userPermission]:target.checked===true});paint()}}
    if(target.id==='user-admin-invite-export-level'&&exportLevels.has(target.value))state.inviteExportLevel=target.value;
    if(target.dataset?.userRole&&editableRoles.has(target.value)){
      const user=state.users.find(row=>row.user_id===target.dataset.userRole);
      if(user&&!protectedUser(user)){state.roles.set(user.user_id,target.value);paint()}
    }
    if(target.dataset?.userExportLevel){
      const user=state.users.find(row=>row.user_id===target.dataset.userExportLevel);
      if(user&&!protectedUser(user)&&validUserLevel(user,target.value)){state.levels.set(user.user_id,target.value);paint()}
    }
  };
  container.onsubmit=async event=>{
    if(!event.target.hasAttribute('data-user-invite')||!current()||!state.authorized)return;
    event.preventDefault();event.stopPropagation?.();
    state.email=String(event.target.elements?.namedItem('invite-email')?.value??state.email).trim();
    const role=event.target.elements?.namedItem('invite-role')?.value??state.inviteRole;
    const level=event.target.elements?.namedItem('invite-export-level')?.value??state.inviteExportLevel;
    if(!/^[^\s@]+@[^\s@]+$/.test(state.email)||state.email.length>254){state.error='Enter a valid email address.';paint();return}
    if(!editableRoles.has(role)){state.error='Choose Read only, Read & write or Manager access.';paint();return}
    if(!exportLevels.has(level)){state.error='Choose Low, Mid1, Mid2, High or Max access.';paint();return}
    state.inviteRole=role;
    state.inviteExportLevel=level;
    await change('invite',{email:state.email,role,export_level:level,...(role==='manager'?{permissions:{...state.invitePermissions}}:{})});
  };
  container.onclick=async event=>{
    const target=event.target.closest('[data-user-action]');
    if(!target||state.busy||state.loading)return;
    const action=target.dataset.userAction;
    if(action==='refresh'){await refresh();return}
    if(!current()||!state.authorized)return;
    const user=state.users.find(row=>row.user_id===target.dataset.userId);
    if(!user||protectedUser(user))return;
    if(action==='save-guest'){const availability=guestLevel(user)&&state.guestAvailability.has(user.user_id)?guestAvailabilityInput(availabilityDraft(user)):null;if(availability?.errors.length){state.error=availability.errors.join(' ');paint();return;}state.busy=true;state.error='';paint();try{await hooks.setGuestAccess({user_id:user.user_id,guest_level:guestLevel(user),guest_permissions:guestOverrides(user),expected_updated_at:user.updated_at,...(availability?.dates||{})});if(!current())return;state.notice='Guest access saved.';await reload();}catch(error){state.error=errorMessage(error);}finally{state.busy=false;paint();}return;}
    if(action==='save-access'){
      const role=state.roles.get(user.user_id)||user.role,level=state.levels.get(user.user_id)||savedExportLevel(user);
      if((role!==user.role||level!==savedExportLevel(user)||(role==='manager'&&permissionChanged(user)))&&editableRoles.has(role)&&validUserLevel(user,level))await change('update_access',{user_id:user.user_id,role,export_level:level,active:Boolean(user.active),...(role==='manager'?{permissions:{...selectedPermissions(user)}}:{})});
    } else if(action==='deactivate'||action==='reactivate') {
      await change('update_access',{user_id:user.user_id,role:user.role,export_level:savedExportLevel(user),active:action==='reactivate',...(user.role==='manager'?{permissions:savedPermissions(user)}:{})});
    }
  };
  await refresh();
}
