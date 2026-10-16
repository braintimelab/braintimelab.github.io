import {esc} from './model.js?v=3';

const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const isoDate=/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;

function normalize(value){
 if(value==null)return null;
 if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value==='boolean')return Number(value);
 const s=String(value).trim();if(!s)return null;
 if(decimal.test(s)&&Number.isFinite(Number(s)))return Number(s);
 if(isoDate.test(s)&&Number.isFinite(Date.parse(s)))return Date.parse(s);
 return s;
}

function compare(a,b,direction){
 if(Array.isArray(a)||Array.isArray(b)){
  const left=Array.isArray(a)?a:[a],right=Array.isArray(b)?b:[b];
  for(let i=0;i<Math.max(left.length,right.length);i++){const result=compare(left[i],right[i],direction);if(result)return result;}
  return 0;
 }
 const left=normalize(a),right=normalize(b);
 // Missing values stay at the end even when the selected order is descending.
 if(left===null||right===null)return left===right?0:left===null?1:-1;
 const result=typeof left==='number'&&typeof right==='number'?Math.sign(left-right):collator.compare(String(left),String(right));
 return direction==='desc'?-result:result;
}

/** Sort a copy; valueFor receives the row and selected column key. */
export function sortRows(rows,state,valueFor){
 if(!state?.key)return rows.slice();
 return rows.map((row,index)=>({row,index,value:valueFor(row,state.key)}))
  .sort((a,b)=>compare(a.value,b.value,state.direction)||a.index-b.index)
  .map(({row})=>row);
}

export function toggleSort(previous,key){
 return {key,direction:previous?.key===key&&previous.direction==='asc'?'desc':'asc'};
}

export function sortHeader(scope,key,title,state){
 const selected=state?.key===key,descending=selected&&state.direction==='desc';
 const order=selected?(descending?'descending':'ascending'):'none';
 const next=selected&&!descending?'descending':'ascending';
 const arrow=selected?(descending?'↓':'↑'):'↕';
 return `<th scope="col" class="sortable" aria-sort="${order}"><button type="button" class="sort-button" data-action="sort" data-sort-scope="${esc(scope)}" data-sort-key="${esc(key)}" aria-label="${esc(title)}: sort ${next}">${esc(title)} <span class="sort-indicator" aria-hidden="true">${arrow}</span></button></th>`;
}
