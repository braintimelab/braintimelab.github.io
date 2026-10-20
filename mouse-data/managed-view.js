// View requirements only. Missing records remain unknown until their scope is
// verified; ordinary menus never request the complete husbandry event table.
export const MANAGED_TABLES=Object.freeze(['mice','matings','litters','cages','rooms','racks','locations','light_events','husbandry_events']);
const HOUSING=['mice','cages','rooms','racks','locations','light_events'];
const STRAINS=['strain_definition'];
const LIGHT=['locobox_protocol','locobox_revision','mouse_entrainment'];
const MOVES=['cage_move','cage_assignment','cage_location_assignment'];
const IACUC=['iacuc_protocol','iacuc_assignment','iacuc_usage','iacuc_design'];
const EXPERIMENTS=['experiment','experiment_sample','experiment_revision'];
const CAGE_HISTORY=[...MOVES,'animal_sheet_cage_snapshot','animal_sheet_source_change','source_manager_observation'];
const distinct=values=>[...new Set(values)];
const needs=(tables=[],eventTypes=[])=>({tables:distinct(tables),eventTypes:distinct(eventTypes)});

export function managedViewNeeds(route,{detail=null,cageDate=''}={}){
 if(['settings','brainbot','archive'].includes(route))return needs();
 if(route==='cages'&&!cageDate)return needs();
 if(route==='cages')return needs(HOUSING,CAGE_HISTORY);
 if(route==='mice')return needs(detail?[...HOUSING,'matings','litters']:['mice','cages','locations'],detail?[...STRAINS,...LIGHT,...EXPERIMENTS,...IACUC]:STRAINS);
 if(route==='matings')return needs(['mice','matings','litters','cages','locations'],['breeding_options',...STRAINS,...IACUC]);
 if(route==='litters')return needs(['mice','matings','litters','cages','locations'],[...STRAINS,...IACUC]);
 if(route==='overview')return needs([...HOUSING,'matings','litters'],['breeding_options','cage_summary_options',...STRAINS]);
 if(route==='family'||route==='planner')return needs(['mice','matings','litters','cages','locations'],[...STRAINS,...(route==='planner'?['breeding_options','breeding_plan']:[])]);
 if(route==='strains')return needs([],STRAINS);
 if(route==='housing')return needs(HOUSING,[...LIGHT,...MOVES]);
 if(route==='locobox')return needs(HOUSING,[...LIGHT,...EXPERIMENTS]);
 if(route==='cryo')return needs(['mice','cages','locations'],['cryopreservation_lot','cryopreservation_event',...STRAINS]);
 if(route==='experiments')return needs(['mice','cages','locations'],[...EXPERIMENTS,...IACUC,...STRAINS]);
 if(route==='iacuc')return needs([...HOUSING,'matings','litters'],[...IACUC,...EXPERIMENTS]);
 if(route==='fees')return needs(HOUSING,['lac_fee_month','lac_fee_options',...CAGE_HISTORY]);
 if(route==='review')return needs([...HOUSING,'matings','litters'],[...STRAINS,...LIGHT,...MOVES,...IACUC]);
 return needs();
}

export function managedEditorNeeds(type){
 if(type==='cages')return needs(['cages','rooms','racks','locations'],[...MOVES,...LIGHT,...IACUC]);
 const view=managedViewNeeds(type,{detail:true});
 return needs(view.tables,[...view.eventTypes,...MOVES,...LIGHT,...IACUC]);
}

export function pendingManagedNeeds(requirements,{tables=[],eventTypes=[]}={}){
 return needs(requirements.tables.filter(name=>tables.includes(name)),requirements.eventTypes.filter(name=>eventTypes.includes(name)));
}
export const hasManagedNeeds=value=>Boolean(value?.tables?.length||value?.eventTypes?.length);
