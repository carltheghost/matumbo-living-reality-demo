import { SurfaceObject } from './surface-semantic-field-three.js';
import {
  analyzeTopology,
  semanticPatchesFromTopology,
  topologySummary,
} from '../domains/topology-semantic-field.js';

/**
 * TopologySurfaceObject
 *
 * Builds on SurfaceObject, but semantic regions are born from the mesh's own
 * topology cells rather than a generic rectangular chart. The base renderer
 * paints each cell using its UV triangles, so ridges/seams/boundaries become
 * the region borders in the object's own material.
 */
export class TopologySurfaceObject extends SurfaceObject {
  constructor({
    topology = null,
    topologyOptions = {},
    content = [],
    ...options
  } = {}) {
    super({ ...options, content });
    const geometry=this.mesh.geometry;
    const positions=geometry.getAttribute('position')?.array;
    const index=geometry.index?.array??null;
    const uvs=geometry.getAttribute('uv')?.array??null;
    this.topology=topology??analyzeTopology({positions,index,uvs,...topologyOptions});
    this.topologySummary=topologySummary(this.topology);
    this.regions=[...semanticPatchesFromTopology({topology:this.topology,content})];
    this.skin=Object.freeze({
      ...this.skin,
      regions:Object.freeze([...this.regions]),
      topology:Object.freeze({schema:this.topology.schema,version:this.topology.version}),
    });
    this.mesh.userData.ssfTopology=this.topology;
    this.renderSkin(true);
  }

  getTopologyPatch(regionId){
    const region=this.regions.find(r=>r.id===regionId);
    if(!region)return null;
    const cell=this.topology.cells.find(c=>c.id===region.topologyCellId)??null;
    return {region,cell,summary:this.topologySummary};
  }
}

export function createTopologySurfaceObject(options){
  return new TopologySurfaceObject(options);
}
