import { SpatialDraftSchema, type SpatialDraft, type SpatialScanContext } from "@/lib/contracts/spatial";
import type { InteriorResponse } from "@/lib/contracts/interior";
import { spatialScanCalibration } from "./prepare-spatial";
import { prepareControlledFurnitureExperiment } from "./controlled-experiment";

export class FloorPlacementRequired extends Error {}
/** One rigid, meter-true alignment anchored to an actual scan floor point, never a suite measurement. */
export function prepareScanFurnitureExperiment(input: {
 current: SpatialDraft; source: InteriorResponse | undefined; scanContext?: SpatialScanContext;
 catalogId: string; question: string; position?: {x:number;z:number};
}) {
 const {source,scanContext}=input;
 if(source?.kind!=="scan")throw new Error("This building has no available Matterport scan.");
 let current=SpatialDraftSchema.parse(input.current);
 let calibration=spatialScanCalibration(source,current);
 const alignment=current.room.alignment;
 if(!calibration && alignment?.modelId===source.modelId)calibration={...alignment,source:"scan-floor-placement"};
 if(!calibration) {
  if(current.room.source!=="assumed"||!scanContext?.placementAvailable||scanContext.modelId!==source.modelId||!scanContext.floorPoint)throw new FloorPlacementRequired("Click the floor to place the proposal.");
  if(current.items.length)throw new Error("Existing proposed furniture needs its original scan placement.");
  const a={source:"scan-floor-placement" as const,projectId:current.projectId,siteId:current.siteId,draftId:current.id,modelId:source.modelId,widthM:current.room.widthM,depthM:current.room.depthM,origin:{...scanContext.floorPoint,y:scanContext.floorPoint.y+.025},rotationY:(scanContext.camera?.rotation.y??0)*Math.PI/180+Math.PI,roomAnchor:{x:current.room.widthM/2,z:current.room.depthM/2}};
  current=SpatialDraftSchema.parse({...current,room:{...current.room,alignment:a},limitations:[...current.limitations,"Proposal is aligned to an actual scan floor point; room extent, entrances, service positions and captured-furniture collisions remain scenario assumptions."].filter((v,i,all)=>all.indexOf(v)===i)});
  calibration=a;
 }
 let position=input.position;
 if(!position) {
  if(!scanContext?.placementAvailable||scanContext.modelId!==source.modelId||!scanContext.floorPoint)throw new FloorPlacementRequired("Click the floor to place the proposal.");
  const dx=scanContext.floorPoint.x-calibration.origin.x,dz=scanContext.floorPoint.z-calibration.origin.z,c=Math.cos(calibration.rotationY),s=Math.sin(calibration.rotationY);
  position={x:calibration.roomAnchor.x+dx*c-dz*s,z:calibration.roomAnchor.z+dx*s+dz*c};
 }
 let suffix=current.revision+1;
 while(current.items.some(i=>i.id===`experiment-item-${suffix}`))suffix++;
 // Prefer the actual pointed position. Nearby alternatives only avoid known proposed obstacles/endpoints.
 const offsets=[[0,0],[.75,0],[-.75,0],[0,.75],[0,-.75],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5]];
 for(const [dx,dz] of offsets) {
  try {return prepareControlledFurnitureExperiment({current,catalogId:input.catalogId,itemId:`experiment-item-${suffix}`,question:input.question,position:{x:position.x+dx!,z:position.z+dz!}});} catch { /* Try bounded nearby placements; never change operational inputs. */ }
 }
 throw new Error("There is not enough clear space here. Choose another floor spot.");
}
