// Shared message types for P3 multiplayer co-editing.
//
// Discriminated union on `type`. Contains only types — no runtime
// logic — so it can be imported safely from any module.
//
// Design reference: claudedocs/design_p3_multiplayer_p2p.md §4

// Serialized fabric object including custom property extras
// (__id, __operatorId, __phase, __seq, __markType, __arrowTip).
// Typed as a plain record here; full fabric types are only needed
// client-side.
export type FabricJSON = Record<string, unknown>;

export type PeerInfo = {
  id: string;
  operatorId: string | null;
  cursor: { x: number; y: number } | null;
};

// ---- Client → server (server stamps ts before relaying) --------

export type JoinMessage = {
  type: 'join';
  peerId: string;
  operatorId: string | null;
};

export type LeaveMessage = {
  type: 'leave';
  peerId: string;
};

export type DeltaAddedMessage = {
  type: 'delta:added';
  peerId: string;
  obj: FabricJSON;
};

export type DeltaModifiedMessage = {
  type: 'delta:modified';
  peerId: string;
  id: string;
  // Full serialized group when isGroup=true; transform-only patch otherwise.
  // See design doc §4.2 and §7.4 for why groups need full re-serialization.
  patch: FabricJSON;
  isGroup: boolean;
  ts?: number;
};

export type DeltaRemovedMessage = {
  type: 'delta:removed';
  peerId: string;
  id: string;
};

export type PathStrokeMessage = {
  type: 'path:stroke';
  peerId: string;
  id: string;
  operatorId: string | null;
  phase: 'plan' | 'record';
  // Flat coordinate array: [x0,y0, x1,y1, ...] for compact framing.
  points: number[];
};

export type PathCommitMessage = {
  type: 'path:commit';
  peerId: string;
  id: string;
};

export type CursorMessage = {
  type: 'cursor';
  peerId: string;
  // Canvas coordinates (pre-viewportTransform). See §9.1.
  x: number;
  y: number;
};

export type ChipClaimMessage = {
  type: 'chip:claim';
  peerId: string;
  operatorId: string;
};

export type ChipReleaseMessage = {
  type: 'chip:release';
  peerId: string;
  operatorId: string;
};

export type ClientMessage =
  | JoinMessage
  | LeaveMessage
  | DeltaAddedMessage
  | DeltaModifiedMessage
  | DeltaRemovedMessage
  | PathStrokeMessage
  | PathCommitMessage
  | CursorMessage
  | ChipClaimMessage
  | ChipReleaseMessage;

// Distributive Omit helper: distributes over union members so each member
// keeps its own discriminant fields (e.g. 'obj', 'id'). Plain
// Omit<ClientMessage, 'peerId'> collapses the union and loses type-specific
// fields. Used as the broadcast() parameter type. §6.2
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type BroadcastMessage = DistributiveOmit<ClientMessage, 'peerId'>;

// ---- Server → client -------------------------------------------

export type PeerJoinedMessage = {
  type: 'peer:joined';
  peerId: string;
  operatorId: string | null;
  ts: number;
};

export type PeerLeftMessage = {
  type: 'peer:left';
  peerId: string;
  ts: number;
};

export type SnapshotMessage = {
  type: 'snapshot';
  canvas: FabricJSON[];
  peers: PeerInfo[];
  // Monotonic server event counter. Client discards buffered
  // deltas with seq ≤ snapshot.seq to avoid double-apply. §4.4
  seq: number;
};

export type ErrorMessage = {
  type: 'error';
  code: string;
  message: string;
};

// InboundMessage: everything the client may receive from the server.
// Relayed ClientMessages are stamped with ts by the server.
export type InboundMessage =
  | PeerJoinedMessage
  | PeerLeftMessage
  | SnapshotMessage
  | ErrorMessage
  | (DeltaAddedMessage & { ts: number })
  | (DeltaModifiedMessage & { ts: number })
  | (DeltaRemovedMessage & { ts: number })
  | PathStrokeMessage
  | PathCommitMessage
  | CursorMessage
  | ChipClaimMessage
  | ChipReleaseMessage;
