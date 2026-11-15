import { describe,it,expect } from "vitest";
import { createSpatialDraft } from "@/lib/spatial";
import { buildInteriorProposal } from "./proposal-state";
import { prepareScanFurnitureExperiment,FloorPlacementRequired } from "./proposal-placement";
import type { InteriorResponse } from "@/lib/contracts/interior";
const source:InteriorResponse={kind:"scan",modelId:"Synthetic01",provenance:{origin:"costar",provider:"matterport",mode:"live",scope:"property",description:"Test source",limitations:[]}};
const current=createSpatialDraft({projectId:"p",siteId:"1:2",city:"houston",category:"coffee"});
const context={modelId:"Synthetic01",floorPoint:{x:-12,y:2,z:7},floorPointSource:"pointer" as const,placementAvailable:true,camera:{position:{x:-12,y:3.5,z:9},rotation:{x:0,y:90}}};
const input={current,source,scanContext:context,catalogId:"wooden_table_02",question:"What happens if I add a table here?"};
// Resolve the exact prepared local catalog ID instead of inventing one.
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
input.catalogId=FURNITURE_CATALOG.find(i=>i.role==="table")?.id ?? FURNITURE_CATALOG.find(i=>i.name.toLowerCase().includes("table"))!.id;
describe("scan-bound controlled proposal",()=>{
 it("places the table at the actual floor point with rigid meters and keeps operational inputs fixed",()=>{
  const next=prepareScanFurnitureExperiment(input);
  const a=next.variant.room.alignment!;
  const proposal=buildInteriorProposal(next.variant,{modelId:a.modelId,origin:a.origin,rotationY:a.rotationY,roomAnchor:a.roomAnchor,source:a.source});
  expect(proposal.items[0]!.position).toEqual({x:-12,y:2.025,z:7});
  expect(next.baseline.settings).toEqual(current.settings);
  expect(next.variant.settings).toEqual(current.settings);
  expect(next.baseline.items).toHaveLength(0);expect(next.variant.items).toHaveLength(1);
  expect(next.variant.room.source).toBe("assumed");
 });
 it("requests a floor point instead of making up a scan location",()=>{
  expect(()=>prepareScanFurnitureExperiment({...input,scanContext:undefined})).toThrow(FloorPlacementRequired);
  expect(()=>prepareScanFurnitureExperiment({...input,scanContext:{...context,modelId:"Synthetic02"}})).toThrow(FloorPlacementRequired);
 });
 it("never maps an existing proposal into another model",()=>{
  const next=prepareScanFurnitureExperiment(input);
  expect(()=>prepareScanFurnitureExperiment({...input,current:next.variant,source:{...source,modelId:"Synthetic02"},scanContext:{...context,modelId:"Synthetic02"}})).toThrow(/original scan placement/);
 });
 it("rejects forged cross-building alignment bindings",()=>{
  const next=prepareScanFurnitureExperiment(input);
  expect(()=>prepareScanFurnitureExperiment({...input,current:{...next.variant,room:{...next.variant.room,alignment:{...next.variant.room.alignment!,siteId:"other"}}}})).toThrow();
 });
});

it("orients the service half of the scenario ahead of the current camera",()=>{
 const next=prepareScanFurnitureExperiment({...input,scanContext:{...context,camera:{...context.camera,rotation:{x:0,y:0}}}});
 const a=next.variant.room.alignment!;
 const z=a.origin.z+(next.variant.servicePoint.z-a.roomAnchor.z)*Math.cos(a.rotationY);
 expect(z).toBeLessThan(a.origin.z);
});
