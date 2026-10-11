/** Vivo coordination contract 1. Time and neural channels are not spatial axes. */
export type Vec = readonly number[];
export type InputSource = 'touch' | 'hand' | 'eye-confirmed' | 'keyboard';
export interface Frame { spaceId: string; chart: string; dimension: number; q: Vec; }
export interface Eye extends Frame { actorId: string; eyeId: string; basis: readonly Vec[]; slice: Readonly<Record<string,number>>; }
export interface StudioBinding {
  schema: 'vivo.studio-binding/1'; bindingId: string; sourceModel: string; sourceNode: number;
  spaceId: string; entityId: string; dimension: number; chart: string; q: Vec;
  metadata: Readonly<{name: string; kind: string}>;
  bindingRevision: number; acceptedSequence: number;
}
export interface Command {
  schema: 'vivo.command/1'; id: string; worldId: string; spaceId: string;
  kind: 'grab.begin' | 'grab.target' | 'grab.end' | 'space.enter' | 'space.exit' | 'world.fork' | 'studio.transform';
  expectedRevision: number; payload: Readonly<Record<string, unknown>>;
}
export interface TargetPayload {
  entityId: string; leaseId: string; source: InputSource; inputEpoch: number;
  targetSeq: number; dimension: number; chart: string; q: Vec; sampleAgeMs: number;
}
export interface Receipt {
  schema: 'vivo.receipt/1'; id: string; status: 'accepted' | 'rejected';
  authorityId: string; acceptedSequence: number; entityRevision: number | null;
  code: string; stateHash: string | null; result: Readonly<Record<string,unknown>> | null;
}
export interface Entity extends Frame {
  id: string; revision: number; v: Vec; materialProfile: string;
  fieldMembership: readonly string[]; innerSpaceId: string | null;
  lineage: readonly string[];
}
export interface Space {
  id: string; dimension: number; intrinsicDimension: number;
  atlasId: string; metricId: string; topologyId: string;
  law: {id: string; version: string}; modelHashes: readonly string[];
  field: {codec: string; handle: string; hash: string}; entities: Readonly<Record<string, Entity>>;
}
export interface Snapshot {
  schema: 'vivo.snapshot/1'; worldId: string; authorityId: string;
  acceptedSequence: number; simulationTime: number; rootSpaceId: string;
  spaces: Readonly<Record<string, Space>>; studioBindings?: Readonly<Record<string, StudioBinding>>; stateHash: string;
}
export interface Session {
  mode: 'local' | 'remote'; actorId: string; worldId: string;
  capabilities: readonly string[]; authorityId: string;
}
export interface Authority {
  open(options: Readonly<Record<string,unknown>>): Promise<Session>;
  getSnapshot(): Snapshot;
  submit(command: Command): Promise<Receipt>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  close(): Promise<void>;
}
export interface Grip {
  entityId: string; leaseId: string; source: InputSource;
  target: Frame; maxForce: number; stiffness: number; damping: number;
}
export interface MaterialStep {
  space: Space; fieldState: unknown; grips: readonly Grip[];
  dt: number; tick: number; randomState: string; mode: 'analytic' | 'learned' | 'shadow';
}
export interface MaterialProposal {
  fieldState: unknown; entityUpdates: readonly {id: string; q: Vec; v: Vec; chart: string}[];
  diagnostics: {mass: number; energy: number; suppliedWork: number; dissipatedEnergy: number; residual: number};
  lawVersion: string; modelHashes: readonly string[]; randomState: string;
}
export interface MaterialDriver {
  capabilities(): Readonly<Record<string, unknown>>;
  step(input: MaterialStep): MaterialProposal;
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
}
export interface InputController {
  begin(context: {entity: Entity; leaseId: string; source: InputSource; inputEpoch: number}): void;
  offer(target: Frame, observedAt: number): boolean;
  end(reason: string): Promise<void>;
  cancel(reason: string): Promise<void>;
  dispose(): Promise<void>;
}
/** Material driver proposes physics. Authority alone accepts/persists shared state.
 * Renderer consumes accepted snapshots plus separately labelled provisional targets.
 * Eye state is per actor/eye, never overwritten by another participant's snapshot.
 * Frozen TypeScript shapes specify interfaces, not a shipped implementation.
 */
