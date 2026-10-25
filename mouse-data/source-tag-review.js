import {buildMouseReviewIssues,attachMouseReviewResolution} from './mouse-review.js?v=100';

const copy=value=>structuredClone(value);
const stable=value=>JSON.stringify(value===undefined?null:Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):value);
const rows=(data,type)=>Array.isArray(data?.tables?.[type])?data.tables[type]:[];
const fail=()=>{throw new Error('The mouse or source label changed. Reopen this label check from Review.');};

/** A label acknowledgement is metadata only. Build it from exact verified
 * payloads, without the record editor's normalizers or housing propagation. */
export function prepareOwnerSourceTagReview(dataset,{issueId,mouseSid,expectedScope=null}={}){
 if(typeof issueId!=='string'||!issueId||typeof mouseSid!=='string'||!mouseSid)fail();
 const issue=buildMouseReviewIssues(dataset).find(row=>row.id===issueId),matches=rows(dataset,'mice').filter(row=>String(row.mouse_sid)===mouseSid);
 if(!issue?.sourceTagReview||issue.sourceTagReview.checked||matches.length!==1||!issue.candidateMouseSids.includes(mouseSid))fail();
 const mouse=matches[0],review=attachMouseReviewResolution(dataset,copy(mouse),issueId,{confirmed:true,mouseSid});
 const links=Array.isArray(mouse.animal_sheet_review_links)?mouse.animal_sheet_review_links:[],changed=review.draft.animal_sheet_review_links.filter(link=>Array.isArray(link.source_tag_review_history)&&link.source_tag_review_history.length>(links.find(old=>old.issue_id===link.issue_id)?.source_tag_review_history?.length||0));
 if(changed.length!==1)fail();
 const link=changed[0],index=links.findIndex(old=>old.issue_id===link.issue_id),events=rows(dataset,'husbandry_events').filter(row=>row.event_id===review.resolutionRecord.event_id);
 if(index<0||events.length!==1||link.association_ref?.event_id!==events[0].event_id)fail();
 const oldLink=links[index],event=events[0],oldHistory=oldLink.source_tag_review_history||[],history=link.source_tag_review_history;
 if(history.length!==oldHistory.length+1||stable(history.slice(0,-1))!==stable(oldHistory)||stable(event.source_tag_review_history||[])!==stable(oldHistory))fail();
 const scope={mouse_sid:mouseSid,issue_id:issueId,event_id:event.event_id,evidence_sha256:link.association_ref.evidence_sha256,ack:copy(history.at(-1)),guards:copy(review.guards)};
 if(expectedScope!==null&&stable(scope)!==stable(expectedScope))fail();
 const afterMouse=copy(mouse),afterEvent=copy(event);
 afterMouse.animal_sheet_review_links[index]={...copy(oldLink),source_tag_review_history:copy(history)};
 afterEvent.source_tag_review_history=copy(history);
 return {scope,readDependencies:copy(review.readDependencies),changes:[{entity_type:'mice',entity_id:mouseSid,before:copy(mouse),payload:afterMouse},{entity_type:'husbandry_events',entity_id:event.event_id,before:copy(event),payload:afterEvent}]};
}
