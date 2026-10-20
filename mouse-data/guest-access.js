/* Guest capabilities are server-enforced. This mirror controls presentation only. */
export const GUEST_LEVELS=Object.freeze({guest1:'Guest-1',guest2:'Guest-2',guest3:'Guest-3'});
const notes=['announcements.read','announcements.write','meetings.read','meetings.write','meetings.upload','meetings.participate','journal_club.read','journal_club.write','journal_club.upload','boards.read','boards.write','boards.common.write','boards.projects.write','boards.create','boards.member','boards.images','resources.read','resources.write','personal.read','personal.write','personal.images','calendar.read','calendar.write','duties.read','experiments.read','experiments.write','reservations.read','reservations.write','shared_pages.read','shared_pages.write','messaging.read','messaging.write'];
export const GUEST_PERMISSION_KEYS=Object.freeze([...notes.map(k=>'notes.'+k),...['overview','cages','mice','breeding','litters','family','planner','strains','housing','experiments','cryo','fees','iacuc'].flatMap(k=>['read','write'].map(a=>`mouse.${k}.${a}`)),'mouse.export',...['orders','inventory','dangerous','usage','vendors','equipment'].flatMap(k=>['read','write'].map(a=>`reagents.${k}.${a}`)),'reagents.export']);
export function guestDefaults(level){
 const permissions=Object.fromEntries(GUEST_PERMISSION_KEYS.map(k=>[k,false]));if(!Object.hasOwn(GUEST_LEVELS,level))return permissions;
 for(const key of ['notes.boards.read','notes.boards.common.write','notes.boards.projects.write','notes.personal.read','notes.personal.write','notes.announcements.read','notes.meetings.read','notes.meetings.write','notes.meetings.upload','notes.meetings.participate','notes.journal_club.read','notes.journal_club.write','notes.journal_club.upload','notes.calendar.read','notes.duties.read','notes.experiments.read','notes.messaging.read','notes.reservations.read','notes.reservations.write','mouse.cages.read','reagents.orders.read','reagents.orders.write'])permissions[key]=true;
 if(level!=='guest1')for(const key of ['notes.boards.write','mouse.cages.write'])permissions[key]=true;
 if(level==='guest3')for(const key of ['notes.shared_pages.read',...['overview','mice','breeding','litters','family','planner','strains','housing','experiments','cryo','fees','iacuc'].map(k=>`mouse.${k}.read`),'reagents.inventory.read','reagents.dangerous.read','reagents.usage.read','reagents.vendors.read','reagents.equipment.read'])permissions[key]=true;
 return permissions;
}
export const GUEST_LOCKED_FEATURES=Object.freeze(['notes.announcements.write','notes.resources.read','notes.resources.write','notes.boards.create','notes.boards.member','notes.boards.images','notes.personal.images',...GUEST_PERMISSION_KEYS.filter(key=>key.startsWith('mouse.')&&key.endsWith('.write')&&key!=='mouse.cages.write')]);
export function guestPermissions(level,overrides={}){const result=guestDefaults(level);for(const [key,value] of Object.entries(overrides||{}))if(Object.hasOwn(result,key)&&typeof value==='boolean')result[key]=value;for(const key of GUEST_LOCKED_FEATURES)result[key]=false;for(const key of ['notes.boards.common.write','notes.boards.projects.write']){if(!Object.hasOwn(overrides||{},key)&&overrides?.['notes.boards.write']===false)result[key]=false;if(result['notes.boards.read']!==true)result[key]=false;}return result;}
export function isGuest(context){return Object.hasOwn(GUEST_LEVELS,context?.guestLevel??context?.guest_level);}
export function guestQuotaLabel(context){if(!isGuest(context))return '';return 'Personal space: up to 300 MB';}
export function guestAllows(context,key){if(context?.active===false)return false;if(isGuest(context)&&['notes.boards.common.write','notes.boards.projects.write'].includes(key)&&(context.role!=='viewer'||(context.exportLevel??context.export_level)!=='low'||validateGuestPermissions(context.guestPermissions??context.guest_permissions??{}).length))return false;return !isGuest(context)||guestAvailabilityStatus(context)==='active'&&guestPermissions(context.guestLevel??context.guest_level,context.guestPermissions??context.guest_permissions)[key]===true;}
export function validateGuestPermissions(value){if(!value||typeof value!=='object'||Array.isArray(value))return ['Guest permissions must be an object.'];return Object.entries(value).filter(([k,v])=>!GUEST_PERMISSION_KEYS.includes(k)||typeof v!=='boolean').map(([k])=>'Unsupported guest permission: '+k);}
export function mouseGuestMenu(section){return ({matings:'breeding',locobox:'housing'})[section]||section;}

export const GUEST_AVAILABILITY_MODES=Object.freeze({unspecified:'Unspecified',until:'Until a date',range:'Date range'});
const availabilityValue=(context,camel,snake)=>Object.hasOwn(context||{},camel)?context[camel]:context?.[snake];
const availabilityBounds=context=>({guest_access_starts_on:availabilityValue(context,'guestAccessStartsOn','guest_access_starts_on'),guest_access_ends_on:availabilityValue(context,'guestAccessEndsOn','guest_access_ends_on')});
const validAvailabilityDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01')return false;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
export function validateGuestAvailability({guest_access_starts_on:start,guest_access_ends_on:end}={}){
 const errors=[];
 if(start!=null&&!validAvailabilityDate(start))errors.push('Enter a valid guest start date (YYYY-MM-DD).');
 if(end!=null&&!validAvailabilityDate(end))errors.push('Enter a valid guest end date (YYYY-MM-DD).');
 if(!errors.length&&start!=null&&end!=null&&start>end)errors.push('Guest end date must be on or after the start date.');
 return errors;
}
export function guestAvailabilityStatus(context,now=Date.now()){
 if(!isGuest(context))return 'active';
 const bounds=availabilityBounds(context);if(validateGuestAvailability(bounds).length)return 'invalid';
 let today;try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));const part=key=>parts.find(p=>p.type===key)?.value;today=`${part('year')}-${part('month')}-${part('day')}`;}catch{return 'invalid';}
 if(bounds.guest_access_starts_on&&today<bounds.guest_access_starts_on)return 'not_started';
 if(bounds.guest_access_ends_on&&today>bounds.guest_access_ends_on)return 'expired';
 return 'active';
}
export function guestAvailabilityExpiresAt(context){
 if(!isGuest(context))return null;
 const bounds=availabilityBounds(context);if(validateGuestAvailability(bounds).length)return NaN;
 return bounds.guest_access_ends_on==null?null:Date.parse(bounds.guest_access_ends_on+'T00:00:00+08:00')+86400000;
}
export function guestAvailabilityDraft(context){const bounds=availabilityBounds(context);return {mode:bounds.guest_access_starts_on!=null?'range':bounds.guest_access_ends_on!=null?'until':'unspecified',startsOn:bounds.guest_access_starts_on??'',endsOn:bounds.guest_access_ends_on??''};}
export function guestAvailabilityInput(draft={}){
 if(!Object.hasOwn(GUEST_AVAILABILITY_MODES,draft.mode))return {errors:['Choose guest availability.']};
 const dates={guest_access_starts_on:draft.mode==='range'?draft.startsOn:null,guest_access_ends_on:draft.mode==='unspecified'?null:draft.endsOn||null};
 const errors=validateGuestAvailability(dates);
 if(draft.mode==='range'&&!draft.startsOn)errors.push('Choose the guest start date.');
 if(draft.mode==='until'&&!draft.endsOn)errors.push('Choose the guest end date.');
 return {dates,errors};
}
export function guestAvailabilityLabel(context,now=Date.now()){
 const bounds=availabilityBounds(context),status=guestAvailabilityStatus(context,now);if(status==='invalid')return 'Availability needs review';
 const start=bounds.guest_access_starts_on,end=bounds.guest_access_ends_on,label=start&&end?`${start} to ${end}`:start?`From ${start}, no expiry`:end?`Until ${end}`:'No expiry';
 return (status==='not_started'?'Not started · ':status==='expired'?'Expired · ':'')+label;
}
