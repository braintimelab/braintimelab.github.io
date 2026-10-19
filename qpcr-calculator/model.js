// Equal-efficiency comparative Ct analysis. Replicate rows are measurements;
// their number never establishes biological replication or a confidence interval.
export const PARSER_LIMITS=Object.freeze({textBytes:2*1024*1024,dataRows:20000,columns:200,fieldCharacters:10000});
export class QpcrError extends Error {
 constructor(code,message,details={}){super(message);this.name='QpcrError';this.code=code;this.details=details;}
}
const fail=(code,message,details)=>{throw new QpcrError(code,message,details);};
const finite=(value,label,{zero=false}={})=>{if(typeof value!=='number'||!Number.isFinite(value)||(zero?value<0:value<=0))fail('INVALID_NUMBER',`${label} must be a finite ${zero?'nonnegative':'positive'} number.`);return value;};
const name=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>PARSER_LIMITS.fieldCharacters||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail('INVALID_NAME',`${label} is required and must be text.`);return value.trim();};
const numberText=(value,label,details)=>{if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))fail('INVALID_NUMBER',`${label} must be a finite positive number.`,details);const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<=0)fail('INVALID_NUMBER',`${label} must be a finite positive number.`,details);return parsed;};
const missing=value=>['','na','n/a','missing'].includes(value.trim().toLowerCase());
const undetermined=value=>['undetermined','undetected','not detected'].includes(value.trim().toLowerCase());
const warning=(code,message,details={})=>({code,message,...details});
const computed=(value,label)=>{if(!Number.isFinite(value))fail('NUMERIC_RANGE',`${label} is outside the supported numeric range.`);return value;};

function records(text,{delimiter='auto'}={}){
 if(typeof text!=='string')fail('INVALID_TABLE','Paste CSV or tab-separated text.');
 if(text.length>PARSER_LIMITS.textBytes||new TextEncoder().encode(text).byteLength>PARSER_LIMITS.textBytes)fail('TABLE_LIMIT','Input exceeds the 2 MiB limit.');
 text=text.replace(/^\uFEFF/,'');if(!text.trim())fail('EMPTY_TABLE','The table is empty.');
 if(!['auto',',','\t'].includes(delimiter))fail('INVALID_DELIMITER','Choose CSV or tab-separated text.');
 if(delimiter==='auto'){
  const first=text.split(/\r\n|\n|\r/).find(line=>line.trim())||'';let quoted=false,commas=0,tabs=0;
  for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted){if(first[i]===',')commas++;if(first[i]==='\t')tabs++;}}
  if(commas&&tabs)fail('AMBIGUOUS_DELIMITER','Choose CSV or tab-separated text explicitly.');delimiter=tabs?'\t':',';
 }
 const output=[];let row=[],field='',quoted=false,closed=false,line=1,startLine=1;
 const append=value=>{field+=value;if(field.length>PARSER_LIMITS.fieldCharacters)fail('TABLE_LIMIT','A field exceeds the 10,000-character limit.',{sourceRow:startLine});};
 const pushField=()=>{row.push(field);if(row.length>PARSER_LIMITS.columns)fail('TABLE_LIMIT','A row exceeds the 200-column limit.',{sourceRow:startLine});field='';closed=false;};
 const pushRow=()=>{pushField();if(row.some(value=>value.trim())){output.push({values:row,sourceRow:startLine});if(output.length>PARSER_LIMITS.dataRows+1)fail('TABLE_LIMIT','The table exceeds 20,000 data rows.');}row=[];};
 for(let i=0;i<=text.length;i++){
  const c=text[i];
  if(quoted){if(c===undefined)fail('INVALID_CSV','A quoted field is not closed.',{sourceRow:startLine});if(c==='"'){if(text[i+1]==='"'){append('"');i++;}else{quoted=false;closed=true;}}else if(c==='\r'||c==='\n'){append('\n');if(c==='\r'&&text[i+1]==='\n')i++;line++;}else append(c);continue;}
  if(c===delimiter){pushField();continue;}
  if(c===undefined||c==='\r'||c==='\n'){pushRow();if(c==='\r'&&text[i+1]==='\n')i++;line++;startLine=line;continue;}
  if(closed){if(c===' ')continue;fail('INVALID_CSV','Unexpected text after a quoted field.',{sourceRow:startLine});}
  if(c==='"'){if(field.length)fail('INVALID_CSV','Quote the entire field and escape internal quotes.',{sourceRow:startLine});quoted=true;}else append(c);
 }
 return output;
}
function table(text,required,options){
 const parsed=records(text,options),header=parsed.shift();if(!header)fail('EMPTY_TABLE','The table is empty.');
 const columns=header.values.map(value=>value.trim().toLowerCase());if(columns.some(value=>!value)||new Set(columns).size!==columns.length)fail('INVALID_HEADER','Column names must be nonempty and unique.');
 for(const column of required)if(!columns.includes(column))fail('MISSING_COLUMN',`The table needs a ${column} column.`);
 for(const row of parsed)if(row.values.length!==columns.length)fail('INVALID_ROW','Every row must have the same number of columns as the header.',{sourceRow:row.sourceRow});
 return parsed.map(row=>({values:Object.fromEntries(columns.map((column,i)=>[column,row.values[i].trim()])),sourceRow:row.sourceRow}));
}
export function parseCtTable(text,options={}){
 const rows=[],excluded=[];
 for(const{values,sourceRow}of table(text,['sample','gene','ct'],options)){
  const sample=name(values.sample,'Sample'),gene=name(values.gene,'Gene'),rawCt=values.ct;
  if(missing(rawCt)||undetermined(rawCt)){excluded.push({sample,gene,rawCt,sourceRow,reason:undetermined(rawCt)?'undetermined_ct':'missing_ct'});continue;}
  rows.push({sample,gene,ct:numberText(rawCt,'Ct',{sourceRow}),sourceRow});
 }
 return{rows,excluded};
}
export function parseStandardTable(text,options={}){
 const rows=[],excluded=[];
 for(const{values,sourceRow}of table(text,['quantity','ct'],options)){
  const rawQuantity=values.quantity,rawCt=values.ct;
  if(missing(rawQuantity)){excluded.push({rawQuantity,rawCt,sourceRow,reason:'missing_quantity'});continue;}
  const quantity=numberText(rawQuantity,'Quantity',{sourceRow});
  if(missing(rawCt)||undetermined(rawCt)){excluded.push({rawQuantity,rawCt,sourceRow,reason:undetermined(rawCt)?'undetermined_ct':'missing_ct'});continue;}
  rows.push({quantity,ct:numberText(rawCt,'Ct',{sourceRow}),sourceRow});
 }
 return{rows,excluded};
}
function measurements(rows){if(!Array.isArray(rows)||!rows.length||rows.length>PARSER_LIMITS.dataRows)fail('INVALID_ROWS','Provide 1 to 20,000 measured Ct rows.');return rows.map(row=>{if(!row||typeof row!=='object')fail('INVALID_ROWS','Every Ct row needs sample, gene and Ct.');return{sample:name(row.sample,'Sample'),gene:name(row.gene,'Gene'),ct:finite(row.ct,'Ct')};});}
function moments(values){let mean=0,m2=0,n=0;for(const value of values){n++;const delta=value-mean;mean+=delta/n;m2+=delta*(value-mean);}return{mean:computed(mean,'Mean'),sd:n>1?computed(Math.sqrt(Math.max(0,m2)/(n-1)),'Standard deviation'):null};}
export function summarizeCt(rows){
 const samples=new Map();
 for(const row of measurements(rows)){if(!samples.has(row.sample))samples.set(row.sample,new Map());const genes=samples.get(row.sample);if(!genes.has(row.gene))genes.set(row.gene,[]);genes.get(row.gene).push(row.ct);}
 const output=[];for(const[sample,genes]of samples)for(const[gene,values]of genes){const{mean,sd}=moments(values);output.push({sample,gene,n:values.length,meanCt:mean,sd});}return output;
}
function selected(values,label,{required=false}={}){if(!Array.isArray(values)||required&&!values.length)fail('INVALID_SELECTION',`Choose ${required?'at least one ':''}${label}.`);const result=values.map(value=>name(value,label));if(new Set(result).size!==result.length)fail('INVALID_SELECTION',`${label} must not contain duplicates.`);return result;}
function powerOfTwo(exponent,warnings,details){const value=2**exponent;if(!Number.isFinite(value)||value<=0){warnings.push(warning('NUMERIC_RANGE','The relative quantity is outside the supported numeric range.',details));return null;}return value;}
// Sparse tables can lack thousands of selected references or calibrators. Keep
// exact counts while bounding display labels, rather than repeating whole lists.
function missingPreview(selection,present){const preview=[];for(const value of selection)if(!present.has(value)){preview.push(value.length>80?value.slice(0,79)+'…':value);if(preview.length===5)break;}return preview;}
const missingDescription=(count,preview)=>`${count}: ${preview.join(', ')}${count>preview.length?', …':''}`;
export function analyzeExpression(rows,{referenceGenes=[],calibrators=[]}={}){
 referenceGenes=selected(referenceGenes,'reference genes',{required:true});calibrators=selected(calibrators,'calibrator samples');
 const summaries=summarizeCt(rows),samples=new Map(),genes=new Set(),warnings=[];
 for(const item of summaries){if(!samples.has(item.sample))samples.set(item.sample,new Map());samples.get(item.sample).set(item.gene,item);genes.add(item.gene);}
 for(const gene of referenceGenes)if(!genes.has(gene))fail('UNKNOWN_REFERENCE',`Reference gene ${gene} has no measured Ct values.`);
 for(const sample of calibrators)if(!samples.has(sample))fail('UNKNOWN_CALIBRATOR',`Calibrator ${sample} has no measured Ct values.`);
 const references=new Set(referenceGenes),referenceCt=new Map();
 for(const[sample,items]of samples){const values=[],present=new Set();for(const[gene,item]of items)if(references.has(gene)){present.add(gene);values.push(item.meanCt);}const missingCount=referenceGenes.length-present.size;if(missingCount){const preview=missingPreview(referenceGenes,present);warnings.push(warning('MISSING_REFERENCE',`Sample ${sample} was excluded because reference measurements are missing (${missingDescription(missingCount,preview)}).`,{sample,missingCount,missingPreview:preview}));continue;}referenceCt.set(sample,moments(values).mean);}
 const baseline=new Map();
 if(calibrators.length){
  const usable=new Map();for(const sample of calibrators){if(!referenceCt.has(sample))continue;for(const[gene,item]of samples.get(sample)){if(references.has(gene))continue;if(!usable.has(gene))usable.set(gene,{samples:new Set(),values:[]});const target=usable.get(gene);target.samples.add(sample);target.values.push(item.meanCt-referenceCt.get(sample));}}
  for(const gene of genes){if(references.has(gene))continue;const target=usable.get(gene),missingCount=calibrators.length-(target?.samples.size||0);if(missingCount){const preview=missingPreview(calibrators,target?.samples||new Set());warnings.push(warning('MISSING_CALIBRATOR',`Fold change for ${gene} is unavailable because chosen calibrators lack usable measurements (${missingDescription(missingCount,preview)}).`,{gene,missingCount,missingPreview:preview}));continue;}baseline.set(gene,moments(target.values).mean);}
 }
 const results=[];
 for(const item of summaries){const{sample,gene}=item;if(references.has(gene)||!referenceCt.has(sample))continue;const deltaCt=item.meanCt-referenceCt.get(sample),calibratorDeltaCt=baseline.get(gene)??null;let deltaDeltaCt=calibratorDeltaCt===null?null:deltaCt-calibratorDeltaCt;
  if(deltaDeltaCt!==null&&!Number.isFinite(deltaDeltaCt)){warnings.push(warning('NUMERIC_RANGE','The Ct difference is outside the supported numeric range.',{sample,gene}));deltaDeltaCt=null;}
  results.push({...item,referenceCt:referenceCt.get(sample),deltaCt,normalizedQuantity:powerOfTwo(-deltaCt,warnings,{sample,gene}),calibratorDeltaCt,deltaDeltaCt,fold:deltaDeltaCt===null?null:powerOfTwo(-deltaDeltaCt,warnings,{sample,gene})});
 }
 if(!results.length)warnings.push(warning('NO_TARGET_RESULTS','No target-gene results have all required reference measurements.'));
 return{summaries,results,warnings,referenceGenes:[...referenceGenes],calibrators:[...calibrators]};
}

export function fitStandardCurve(points){
 if(!Array.isArray(points)||points.length<2||points.length>PARSER_LIMITS.dataRows)fail('INVALID_CURVE','Provide 2 to 20,000 standard measurements.');
 const input=points.map(point=>{if(!point||typeof point!=='object')fail('INVALID_CURVE','Each standard needs positive quantity and Ct.');return{quantity:finite(point.quantity,'Quantity'),ct:finite(point.ct,'Ct')};});
 const xs=input.map(point=>Math.log10(point.quantity)),ys=input.map(point=>point.ct),xMean=moments(xs).mean,yMean=moments(ys).mean;let sxx=0,sxy=0,syy=0;
 for(let i=0;i<input.length;i++){const x=xs[i]-xMean,y=ys[i]-yMean;sxx+=x*x;sxy+=x*y;syy+=y*y;}
 if(sxx===0)fail('DEGENERATE_CURVE','At least two distinct log10 quantities are required.');
 const slope=computed(sxy/sxx,'Slope'),intercept=computed(yMean-slope*xMean,'Intercept');let residual=0;
 for(let i=0;i<input.length;i++)residual+=(ys[i]-(intercept+slope*xs[i]))**2;
 const r2=syy===0?null:Math.min(1,Math.max(0,computed(1-residual/syy,'R²'))),warnings=[];
 if(input.length===2)warnings.push(warning('TWO_POINT_CURVE','Two points define a line; add more standards to assess the calibration.'));
 if(slope>=0)warnings.push(warning('NON_NEGATIVE_SLOPE','A usable qPCR calibration needs a negative slope.'));
 let efficiencyPercent=null;if(slope!==0){const value=100*(10**(-1/slope)-1);if(Number.isFinite(value))efficiencyPercent=value;else warnings.push(warning('NUMERIC_RANGE','Amplification efficiency is outside the supported numeric range.'));}
 return{slope,intercept,r2,efficiencyPercent,n:input.length,points:input,quantityMin:Math.min(...input.map(p=>p.quantity)),quantityMax:Math.max(...input.map(p=>p.quantity)),ctMin:Math.min(...ys),ctMax:Math.max(...ys),warnings};
}
export function inverseStandardQuantity(curve,ct){
 finite(ct,'Ct');if(!curve||typeof curve!=='object'||!Number.isFinite(curve.slope)||curve.slope>=0||!Number.isFinite(curve.intercept))fail('INVALID_CURVE','Use a fitted curve with a finite negative slope.');
 const quantity=10**((ct-curve.intercept)/curve.slope);if(!Number.isFinite(quantity)||quantity<=0)fail('NUMERIC_RANGE','Estimated quantity is outside the supported numeric range.');
 const warnings=[];if(!Number.isFinite(curve.quantityMin)||!Number.isFinite(curve.quantityMax)||curve.quantityMin<=0||curve.quantityMax<curve.quantityMin)fail('INVALID_CURVE','The calibration range is missing or invalid.');
 const tolerance=1e-12;if(quantity<curve.quantityMin*(1-tolerance)||quantity>curve.quantityMax*(1+tolerance))warnings.push(warning('OUTSIDE_STANDARD_RANGE','The estimate extrapolates outside the measured standard quantities.'));
 return{quantity,warnings};
}

export function prepareReactions({ingredients,reactions,overagePercent=0,totalReactionVolume}={}){
 if(!Array.isArray(ingredients)||!ingredients.length||ingredients.length>100)fail('INVALID_INGREDIENTS','Enter 1 to 100 reagent components.');
 if(!Number.isSafeInteger(reactions)||reactions<1)fail('INVALID_REACTIONS','The number of reactions must be a positive integer.');finite(overagePercent,'Overage percentage',{zero:true});
 const names=new Set(),prepared=ingredients.map(item=>{if(!item||typeof item!=='object')fail('INVALID_INGREDIENTS','Every component needs a name and per-reaction volume.');const label=name(item.name,'Component name');if(names.has(label.toLowerCase()))fail('DUPLICATE_INGREDIENT','Component names must be distinct.');names.add(label.toLowerCase());return{name:label,volume:finite(item.volume,'Per-reaction volume',{zero:true})};});
 const sum=computed(prepared.reduce((total,item)=>total+item.volume,0),'Reaction volume');let totalPerReaction=sum,waterPerReaction=null;
 if(totalReactionVolume!==undefined){finite(totalReactionVolume,'Final reaction volume');const difference=totalReactionVolume-sum,tolerance=1e-12*Math.max(1,totalReactionVolume,sum);if(difference < -tolerance)fail('NEGATIVE_WATER_VOLUME','Components exceed the final reaction volume.');waterPerReaction=Math.max(0,difference);totalPerReaction=totalReactionVolume;}
 if(totalPerReaction<=0)fail('INVALID_REACTION_VOLUME','The total reaction volume must be positive.');
 const effectiveReactions=computed(reactions*(1+overagePercent/100),'Reaction count with overage'),result=prepared.map(item=>({...item,totalVolume:computed(item.volume*effectiveReactions,'Component total volume')}));
 return{reactions,overagePercent,effectiveReactions,ingredients:result,totalPerReaction,totalVolume:computed(totalPerReaction*effectiveReactions,'Total preparation volume'),waterPerReaction,waterTotal:waterPerReaction===null?null:computed(waterPerReaction*effectiveReactions,'Water volume')};
}
export function diluteTemplate({stockConcentration,targetConcentration,finalVolume}={}){
 finite(stockConcentration,'Stock concentration');finite(targetConcentration,'Target concentration');finite(finalVolume,'Final volume');
 if(targetConcentration>stockConcentration*(1+1e-12))fail('CONCENTRATION_INCREASE','Dilution cannot produce a concentration above the stock.');
 const ratio=Math.min(1,targetConcentration/stockConcentration),stockVolume=computed(ratio*finalVolume,'Stock volume');if(stockVolume<=0)fail('NUMERIC_RANGE','Stock volume is outside the supported numeric range.');
 return{stockVolume,diluentVolume:Math.max(0,finalVolume-stockVolume),finalVolume,dilutionFactor:computed(1/ratio,'Dilution factor')};
}
