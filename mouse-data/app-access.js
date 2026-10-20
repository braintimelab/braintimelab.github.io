import {GUEST_PERMISSION_KEYS,isGuest,guestAllows} from './guest-access.js?v=163';

export const APP_PERMISSION_KEYS=Object.freeze({
 notes:Object.freeze([...GUEST_PERMISSION_KEYS.filter(key=>key.startsWith('notes.')),'notes.duties.write']),
 mouse:Object.freeze([...GUEST_PERMISSION_KEYS.filter(key=>key.startsWith('mouse.')),'mouse.review.read','mouse.review.write','mouse.brainbot.read','mouse.imports.write','mouse.archive.read','mouse.archive.write']),
 reagents:Object.freeze(GUEST_PERMISSION_KEYS.filter(key=>key.startsWith('reagents.')))
});
export function announcementPostingEligible(context){
 if(!context||(context.guestLevel??context.guest_level)!=null)return false;
 return context.role==='owner'||context.role==='manager'||context.role==='editor'&&['high','max'].includes(context.exportLevel??context.export_level);
}
export function validAppPermissions(app,value){return Object.hasOwn(APP_PERMISSION_KEYS,app)&&value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length<=APP_PERMISSION_KEYS[app].length&&Object.entries(value).every(([key,allowed])=>APP_PERMISSION_KEYS[app].includes(key)&&typeof allowed==='boolean');}
// A restriction layer only: callers retain their role, ownership and data checks.
export function appAllows(context,key){
 const app=typeof key==='string'?key.split('.')[0]:'';if(!context||!APP_PERMISSION_KEYS[app]?.includes(key))return false;
 if(key==='notes.announcements.write'&&!announcementPostingEligible(context))return false;
 if(isGuest(context))return guestAllows(context,key);
 if(context.role==='owner')return true;
 const camel=app+'Permissions',snake=app+'_permissions',permissions=Object.hasOwn(context,camel)?context[camel]:Object.hasOwn(context,snake)?context[snake]:{};
 return validAppPermissions(app,permissions)&&permissions[key]!==false;
}
export function mouseAppFeature(section){return ({matings:'breeding',locobox:'housing',locations:'housing',rooms:'housing',racks:'housing',light_events:'housing'})[section]||section;}
