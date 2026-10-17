const TABLES = Object.freeze({
 mice: {id:'mouse_sid',date:'date_of_birth'},
 matings: {id:'mating_sid',date:'set_up_date'},
 litters: {id:'litter_sid',date:'date_of_birth'},
});

export const tableHistoryConfig = type => TABLES[type] || null;

function validDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.slice(0,4)==='0000')return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function tableRecordDate(type,record) {
 const key=TABLES[type]?.date,value=key&&record?.[key];
 return validDate(value)?value:null;
}

function yearsBefore(value,years) {
 const year=Number(value.slice(0,4))-years,month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
 const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
 return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(Math.min(day,lastDay)).padStart(2,'0')}`;
}

function dayBefore(value) {
 const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-1);
 return date.toISOString().slice(0,10);
}

export function tableHistoryView(type,records,{asOf,windowIndex=0,undated=false}={}) {
 if(!TABLES[type])return null;
 if(!validDate(asOf))throw new Error('Choose a valid table date.');
 if(!Number.isSafeInteger(windowIndex)||windowIndex<0||windowIndex>Math.floor((Number(asOf.slice(0,4))-1)/3)-1)throw new Error('Invalid table history window.');
 const start=yearsBefore(asOf,3*(windowIndex+1)),end=windowIndex?yearsBefore(asOf,3*windowIndex):null;
 const rows=[];let undatedCount=0,hasOlder=false;
 for(const record of records||[]){
  const date=tableRecordDate(type,record);
  if(!date){undatedCount++;if(undated)rows.push(record);continue;}
  if(date<start)hasOlder=true;
  if(!undated&&date>=start&&(!end||date<end))rows.push(record);
 }
 return {rows,start,end,windowIndex,undated,undatedCount,hasOlder:!undated&&hasOlder,label:undated?'Undated':end?`${start} – ${dayBefore(end)}`:`Since ${start}`};
}

export function compareTableRecency(type,a,b) {
 const ad=tableRecordDate(type,a),bd=tableRecordDate(type,b);
 if(ad!==bd){if(!ad)return 1;if(!bd)return-1;return ad>bd?-1:1;}
 const id=TABLES[type]?.id;
 const av=String(a?.[id]??''),bv=String(b?.[id]??'');
 return av.localeCompare(bv,'en',{numeric:true})||av.localeCompare(bv,'en');
}

export function tableHistoryPage({windowIndex=0,undated=false,page=0,rowCount=0,pageSize=50,hasOlder=false},direction) {
 const lastPage=Math.max(0,Math.ceil(rowCount/pageSize)-1),current=Math.min(Math.max(0,page),lastPage);
 if(direction==='next'){
  if(current<lastPage)return {windowIndex,undated,page:current+1};
  if(!undated&&hasOlder)return {windowIndex:windowIndex+1,undated:false,page:0};
 }else if(direction==='previous'){
  if(current>0)return {windowIndex,undated,page:current-1};
  if(!undated&&windowIndex>0)return {windowIndex:windowIndex-1,undated:false,page:Number.MAX_SAFE_INTEGER};
 }
 return {windowIndex,undated,page:current};
}
