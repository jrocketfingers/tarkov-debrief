# P3 Multiplayer Co-Editing — P2P Variant Design Document

**Created:** 2026-06-05
**Based on:** `claudedocs/design_p3_multiplayer.md` (WebSocket relay variant)
**Scope:** Same external feature set as the relay variant (P3.1–P3.5),
re-architected to use WebRTC DataChannels for all canvas data traffic
and a minimal signaling-only server instead of a full relay server.
**Output type:** Architecture / component design.

---

## 0. Decisions resolved for this variant

### 0a. Core topology decision

| Tension | Decision |
|---|---|
| WebSocket relay server vs. peer-to-peer | **WebRTC DataChannels, full mesh.** For squads of 2–5, full mesh means at most 10 peer-to-peer connections. Canvas deltas flow directly between browsers — the server sees no canvas data at all. |
| Signaling mechanism | **Minimal custom signaling server** (Node.js + `ws`, ~150 lines). Stateless relative to canvas: it only routes WebRTC offer/answer/ICE candidates, never touches canvas objects. Once the DataChannel is open, the signaling server is idle. Firebase Realtime DB is a serverless alternative (see §5.5). |
| WebRTC library | **Native `RTCPeerConnection` API** (no wrapper library). `simple-peer` was considered but only natively supports one DataChannel; getting a second requires accessing `peer._pc` (private, fragile). The design needs two channels (`reliable` + `ephemeral`), so native WebRTC is cleaner. The boilerplate is ~80 lines, fully specified in §6.4. |
| DataChannel reliability | **Two channels per peer pair.** `reliable` (ordered, TCP-like) for canvas deltas, snapshot, and lifecycle. `ephemeral` (unordered, UDP-like) for cursor positions and partial-path points. Ephemeral messages can be dropped without consistency impact; using an unordered channel avoids head-of-line blocking against canvas deltas. |
| Conflict resolution | **Lamport timestamps (logical clocks), not wall clock.** Without a server-authoritative wall clock, wall time is unsafe. Each peer maintains a monotonic integer clock, incremented on every send and max-merged on every receive. `delta:modified` conflict: higher Lamport clock wins; tie-break by lexicographic peerId. |
| Snapshot for new joiners | **Eldest peer (longest-connected) provides snapshot.** The signaling server tracks join order (join timestamp) per room entry. The new joiner receives the peer list sorted by seniority; it opens a DataChannel to the eldest peer and requests the snapshot over the `reliable` channel. If the eldest peer is absent, the next-oldest takes over. |
| Canvas storage | **None.** Canvas lives only in connected peers' memory. The signaling server stores zero canvas state. A server restart or network partition does not corrupt canvas — as long as at least one peer stays connected, the canvas survives. When all peers disconnect, the canvas is gone (no TTL needed on the server). |
| STUN/TURN | **STUN only: Google's public servers (free). No TURN server.** Peers behind symmetric NAT (corporate firewalls) cannot connect — accepted as a hard limitation. The app surfaces a clear "direct connection failed" error. The target squad plays on home or LAN networks where STUN is sufficient. |
| Peer identity | Same as relay variant: `sessionStorage`-scoped UUID. |
| Auth / permissions | Same as relay variant: none for P3. URL-based join. |

### 0b. Differences from the relay variant

| Aspect | Relay variant | P2P variant |
|---|---|---|
| Server role | Full relay — all messages pass through | Signaling only — exchanges SDP + ICE; then idle |
| Canvas mirror on server | Yes — in-memory per room | No — canvas exists only in peer browsers |
| Conflict timestamp source | Server-stamped `Date.now()` | Lamport logical clock (peer-generated, max-merged) |
| Snapshot provider | Server | Eldest connected peer |
| Server restart impact | Rooms wiped (canvas gone) | Canvas survives in peers' browsers; peers reconnect and re-mesh |
| New dependency | `ws` (server direct dep) | `ws` (signaling server only); native WebRTC used client-side (no new client dep) |
| Horizontal scaling | Single process for P3; Redis pub/sub for P4 | Signaling server is inherently stateless per-connection; scales trivially |
| Corporate NAT | Works (server has stable IP) | Cannot connect — symmetric NAT is a hard limitation (no TURN, accepted by design) |
| Canvas data privacy | Server process sees all canvas JSON | Server never sees any canvas object |

---

## 1. What this slice ships

Feature set is identical to the relay variant. Only the transport
layer changes. References to §3–§9 of this document show where the
implementation diverges.

**P3.1 — Room infrastructure.** Minimal signaling server.
`usePeerRoom` hook manages WebRTC lifecycle, peer mesh, and
reconnection. Room URL injected as `?room=<uuid>`.

**P3.2 — Remote delta application.** `useRemoteCanvas` applies
incoming `delta:added`, `delta:modified`, `delta:removed` from the
reliable DataChannel without touching the local undo stack. Lamport
timestamp conflict resolution lives here.

**P3.3 — Ghost cursors.** Same as relay variant. Cursor positions
travel over the ephemeral DataChannel.

**P3.4 — Partial-path streaming.** Same as relay variant. Stroke
points travel over the ephemeral DataChannel.

**P3.5 — Operator chip claim + peer presence UI.** Same as relay
variant.

## 2. What this slice does NOT ship

Identical to relay variant §2. Additionally:

- **TURN server.** No TURN server is provisioned. Peers on symmetric
  NAT networks (corporate firewalls, some university networks) cannot
  connect. This is a deliberate decision — the target squad uses home
  or LAN networks where Google's STUN servers are sufficient.

---

## 3. Architecture Overview

### 3.1 Current state (recap)

Same as relay variant §3.1. Fabric.js canvas, `useUndo` named-ref
pattern, `__id` on every object from `tagObject`.

### 3.2 New architecture (after P3 P2P)

```
                       App.tsx
                          │
     ┌────────────────────┼──────────────────────────┐
     │                    │                          │
 canvas state        peer mesh state           operator state
 (existing)         (new: usePeerRoom)          (existing + peer ownership)
     │                    │
     │          ┌─────────┴──────────────────────────────────────────────┐
     │          │                                                        │
     │    useRemoteCanvas                                    GhostCursorLayer
     │    (apply deltas from reliable DataChannel,          (HTML overlay)
     │     Lamport clock conflict resolution)
     │          │
     └──────────┤
                │
        usePartialPath
        (stream in-progress strokes via ephemeral DataChannel)

  Signaling server (Node.js + ws, ~150 lines)
    ├── WS /signal/:roomId   — routes offer/answer/ICE between peers
    ├── GET /room/:roomId    — HTTP: { exists: bool, peers: PeerSummary[] }
    └── GET /health          — 200 "ok"
    (stores NO canvas state; only ephemeral peer metadata for handshaking)

  Full mesh DataChannels (browser ↔ browser)
    ├── reliable   — ordered, TCP-like:  delta:*, snapshot, join/leave/chip
    └── ephemeral  — unordered, UDP-like: cursor, path:stroke, path:commit

  <RoomBar />           ← new: connection status + copy-link
  <OperatorChips />     ← extended: per-chip peer badge
  <GhostCursorLayer />  ← new: HTML overlay, pointer-events: none
```

### 3.3 Full mesh topology

With N peers, there are N(N−1)/2 DataChannel pairs. For the squad
sizes P3 targets:

| Peers | Pairs | Channels (×2 per pair) |
|---|---|---|
| 2 | 1 | 2 |
| 3 | 3 | 6 |
| 4 | 6 | 12 |
| 5 | 10 | 20 |

This is well within browser WebRTC limits. Each canvas delta is sent
once per remote peer (fan-out on the sender). The sender's broadcast
loop iterates the peer connections and calls `send()` on each
reliable channel.

### 3.4 Eldest peer as snapshot authority

When peer B joins a room where peer A is already connected:

1. Signaling server sends B the peer list: `[{ id: A, joinedAt: <ts> }]`.
2. B opens a WebRTC connection to A (B is initiator).
3. Once the DataChannel opens, B sends `{ type: 'snapshot:request' }` on
   the reliable channel.
4. A serializes `canvas.toJSON(['__id', '__operatorId', ...])`, splits
   the `.objects` array into 60 KB chunks, sends each as
   `{ type: 'snapshot:chunk', index, total, canvas: chunk }`, then
   sends `{ type: 'snapshot:done', lc: now() }`.
5. B assembles chunks, applies with `withRemote(() => canvas.loadFromJSON(...))`,
   and in `.then()` sets its Lamport clock to `max(B.lamport, snapshot.lc) + 1`.
6. Subsequent deltas from A and other peers are applied normally.

If peer C joins while A and B are both present, C selects A (older join
timestamp) as snapshot authority. If A then disconnects, C falls back to B.

### 3.5 Existing patterns reused

Same as relay variant §3.3 — named handler refs, ref-mirrors,
`REPLAY`/`TRANSIENT` sentinels, `unerasable` set, `tagObject` `__id`.
The `applyingRemote` module flag from `useRemoteCanvas` is unchanged.

---

## 4. Protocol Specification

### 4.1 Transport

**DataChannel (WebRTC)**, not WebSocket. Two channels per peer pair:

| Channel | `ordered` | `maxRetransmits` | Used for |
|---|---|---|---|
| `reliable` | `true` | `undefined` (unlimited) | `delta:*`, `snapshot:*`, lifecycle |
| `ephemeral` | `false` | `0` (fire-and-forget) | `cursor`, `path:stroke`, `path:commit` |

All frames are UTF-8 JSON strings. No binary framing in P3.

**Signaling transport**: WebSocket (`wss://`) to the signaling server.
The signaling WS is only open during handshaking; it can be left open
as a keepalive channel for peer-join/leave notifications (see §5.3).

### 4.2 Lamport clock

Each peer maintains a module-scoped integer `lamport`:

```ts
// src/collab/lamport.ts
let clock = 0;

/** Increment before sending; attach to outgoing message. */
export function tick(): number { return ++clock; }

/** Merge on receive; call before processing the message. */
export function merge(remote: number): void {
  clock = Math.max(clock, remote) + 1;
}

export function now(): number { return clock; }

/** Reset to 0 — for use in tests only (vi.resetModules() also works
 *  but is heavier). Call in beforeEach to prevent inter-test clock bleed. */
export function resetForTesting(): void { clock = 0; }
```

Every message on the `reliable` channel carries `lc: number`.
On receive, the recipient calls `merge(msg.lc)` before dispatching.

**Conflict resolution for `delta:modified`**: the message with the
higher `lc` wins. On tie (astronomically unlikely given logical clock
semantics), the lexicographically larger `peerId` wins. This is
deterministic across all peers — every peer applies the same rule and
converges to the same object state.

### 4.3 Message types

All messages share a discriminated union on `type`.

```ts
// src/collab/protocol.ts — P2P variant
// (replaces the relay-variant protocol.ts)

// ---- Peer → peer (over reliable DataChannel) ----------------------

// Lifecycle
{ type: 'p2p:join';    peerId: string; operatorId: string | null; lc: number }
{ type: 'p2p:leave';   peerId: string; lc: number }

// Canvas deltas
{ type: 'delta:added';    peerId: string; obj: FabricJSON;          lc: number }
{ type: 'delta:modified'; peerId: string; id: string;
                          patch: FabricJSON; isGroup: boolean;       lc: number }
{ type: 'delta:removed';  peerId: string; id: string;               lc: number }

// Snapshot (eldest peer → new joiner only)
{ type: 'snapshot:request'; peerId: string }
{ type: 'snapshot:chunk';   peerId: string; index: number;
                             total: number; canvas: FabricJSON[] }
{ type: 'snapshot:done';    peerId: string; lc: number }

// Chip ownership
{ type: 'chip:claim';   peerId: string; operatorId: string; lc: number }
{ type: 'chip:release'; peerId: string; operatorId: string; lc: number }

// ---- Peer → peer (over ephemeral DataChannel) ----------------------

{ type: 'cursor';      peerId: string; x: number; y: number }
{ type: 'path:stroke'; peerId: string; id: string;
                        operatorId: string | null;
                        phase: 'plan' | 'record';
                        points: number[] }
{ type: 'path:commit'; peerId: string; id: string }

// ---- Peer → signaling server (via WebSocket) -----------------------

{ type: 'sig:join';    roomId: string; peerId: string }
{ type: 'sig:offer';   to: string; from: string; sdp: RTCSdpInit }
{ type: 'sig:answer';  to: string; from: string; sdp: RTCSdpInit }
{ type: 'sig:ice';     to: string; from: string;
                        candidate: RTCIceCandidateInit }
{ type: 'sig:leave';   peerId: string }

// ---- Signaling server → peer (via WebSocket) -----------------------

{ type: 'sig:peers';   peers: SigPeerInfo[] }   // list on join
{ type: 'sig:joined';  peerId: string; joinedAt: number }
{ type: 'sig:left';    peerId: string }
{ type: 'sig:offer';   to: string; from: string; sdp: RTCSdpInit }
{ type: 'sig:answer';  to: string; from: string; sdp: RTCSdpInit }
{ type: 'sig:ice';     to: string; from: string;
                        candidate: RTCIceCandidateInit }
{ type: 'sig:error';   code: string; message: string }

// Supporting types
type SigPeerInfo = { id: string; joinedAt: number };

// BroadcastMessage: what the caller passes to room.broadcast() — no peerId
// (usePeerRoom injects peerId before sending). Distributes over the union so
// each member retains its discriminant fields.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type P2PCanvasMessage =
  | DeltaAddedMessage | DeltaModifiedMessage | DeltaRemovedMessage
  | PathStrokeMessage | PathCommitMessage | CursorMessage
  | ChipClaimMessage  | ChipReleaseMessage;
type BroadcastMessage = DistributiveOmit<P2PCanvasMessage, 'peerId'>;

// InboundMessage: what onMessage() delivers to hooks.
// usePeerRoom normalizes both p2p:leave and DataChannel-close into PeerLeftMessage
// so downstream hooks (usePartialPath, GhostCursorLayer) need no P2P-specific changes.
type PeerLeftMessage  = { type: 'peer:left';   peerId: string };
type PeerJoinedMessage = { type: 'peer:joined'; peerId: string; operatorId: string | null };
// SnapshotReadyMessage is intentionally NOT here — it is an internal
// usePeerRoom signal, not a wire type. Define it in usePeerRoom.ts only.
//
// NOTE: Unlike the relay variant (which used `& { ts: number }` intersections because
// the server stamped ts on relay), P2P delta and chip types already include `lc: number`
// in their base definitions above. No intersection needed — use the types directly.
// Chip messages carry lc so handlers can call merge(msg.lc) for clock synchronization.
type InboundMessage =
  | PeerJoinedMessage | PeerLeftMessage
  | DeltaAddedMessage | DeltaModifiedMessage | DeltaRemovedMessage
  | PathStrokeMessage | PathCommitMessage
  | CursorMessage | ChipClaimMessage | ChipReleaseMessage;
```

`FabricJSON` is the same as the relay variant (§4.2 of relay doc):
`toObject(['__id', '__operatorId', '__phase', '__seq',
'__markType', '__arrowTip'])`.

**`lc` on all reliable-channel messages** is the sender's Lamport
clock value at send time. It is the conflict-resolution key for
`delta:modified`.

**Chunked snapshot** (`snapshot:chunk`): the canvas JSON array is
split into 60 KB chunks before sending over the DataChannel. The
receiver accumulates chunks by `index` and reassembles when
`index === total − 1`. 60 KB is well within the Chrome DataChannel
max message size (256 KB) with headroom for other traffic.

### 4.4 Ordering guarantees

Reliable DataChannels are **ordered per channel** (TCP-like). A
single peer's `delta:added` is always delivered before its subsequent
`delta:modified` from the same peer's channel.

There is **no cross-peer ordering guarantee** for the same reason as
the relay variant — adds are commutative by `__id`.

The Lamport clock provides a **happens-before relationship** for
`delta:modified` conflicts: a modify with a higher Lamport clock
necessarily came from a peer that had already seen more events.

### 4.5 Snapshot protocol

See §3.4 for the join flow. Key invariant: the receiving peer sets
`applyingRemote = true` before `canvas.loadFromJSON` and clears it
in the resolved Promise, preventing the broadcast effect from
re-broadcasting loaded objects to the mesh. Same mechanism as relay
variant §4.4.

**Cross-module dependency:** `usePeerRoom` imports `withRemote` from
`remoteFlag.ts` to wrap the snapshot `loadFromJSON` call. This is the
only place outside `useRemoteCanvas` that touches `applyingRemote`.
Both modules import from the same singleton `remoteFlag.ts` — the flag
is shared correctly at the module level.

Deltas that arrive over any DataChannel during snapshot application
are queued in a local array (`pendingDeltas`) and applied in Lamport
order after the snapshot's `loadFromJSON` resolves. Deltas with
`lc ≤ snapshot.lc` are discarded (already covered by snapshot).

---

## 5. Signaling Server

### 5.1 Purpose and scope

The signaling server's only job is to route WebRTC handshaking
messages (SDP offers/answers and ICE candidates) between peers in the
same room. It does not:

- Store or relay canvas deltas.
- Store canvas objects.
- Apply conflict resolution.
- Hold canvas state across reconnects.

This makes it dramatically simpler than the relay variant's server.
Total implementation target: ~150 lines of TypeScript (compare to
~300 lines for the relay variant's rooms.ts alone).

### 5.2 Room model (signaling only)

```ts
// signaling-server/src/rooms.ts

type SigPeer = {
  id: string;
  joinedAt: number;
  ws: WebSocket;
};

type SigRoom = {
  id: string;
  peers: Map<string, SigPeer>;
};

const rooms = new Map<string, SigRoom>();
```

No canvas mirror. No TTL timer (room disappears when the last peer
WebSocket closes). No object store.

### 5.3 Message routing

```
peer → server: sig:join { roomId, peerId }
  → server sends sig:peers (list of peers already in room, BEFORE adding the joiner)
  → server stores the new peer
  → broadcasts sig:joined to all other peers in room
  (sig:peers must exclude the joining peer itself — server sends the snapshot
   of existing peers before inserting the new one, or filters out the joiner's id)

peer → server: sig:offer / sig:answer / sig:ice { to, from, ... }
  → server forwards to the target peer identified by `to`; no validation of SDP content

peer → server: sig:leave OR WebSocket close
  → server removes peer, broadcasts sig:left to all remaining peers in room
```

The server validates `roomId` as UUID v4 (same regex as relay
variant §5.5) and validates `to` is a known `peerId` in the room
before forwarding offer/answer/ICE. Unknown `to` peers receive a
`sig:error` back to the sender.

### 5.4 HTTP endpoint

```
GET /room/:id   → 200 { exists: bool, peerCount: number }
GET /health     → 200 "ok"
WS  /signal/:id → WebSocket upgrade (signaling channel for room :id)
```

### 5.5 Serverless alternative: Firebase Realtime Database

If no server hosting is desired at all, the signaling exchange can
use Firebase Realtime Database (free tier, 1 GB storage, 10 GB
transfer/month):

- Each room is a Firebase path `/rooms/{roomId}/signals/{targetPeerId}`.
- Peers write offer/answer/ICE objects to the target path.
- The target peer listens with `onChildAdded` and processes signals.
- `onDisconnect().remove()` provides automatic cleanup on tab close.

**Trade-offs vs. custom server:**

| | Custom signaling server | Firebase |
|---|---|---|
| Infrastructure to manage | Small (fits on free Fly.io tier) | None |
| Latency | Lower (direct WS) | Higher (Firebase round-trip ~100–200 ms) |
| Privacy | Signals stay on your server | Signals pass through Google |
| Offline resilience | Server must be up for new joins | Firebase handles availability |
| Cost | Server compute | Firebase free tier (ample for P3) |

For P3 with its small scale, either works. The custom server is
recommended for lower latency and privacy. Firebase is documented
here as a fallback requiring zero infrastructure.

### 5.6 STUN configuration

```ts
// src/collab/iceServers.ts
// Google's public STUN servers — free, no account needed.
// Covers home routers and LAN connections (the target environment).
// Peers behind symmetric NAT (corporate firewalls) cannot connect;
// this is a known hard limitation — no TURN server is used.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
```

When ICE negotiation fails, `rtc.onconnectionstatechange` fires with
`'failed'`. `usePeerRoom` catches this and surfaces: "Direct connection
failed. This can happen on corporate or university networks. Try
connecting from a home network."

The connection attempt is not retried automatically — a failed ICE
negotiation on symmetric NAT will not succeed on retry without a
TURN server.

### 5.7 Deployment

The signaling server is even lighter than the relay variant's server.
Any Node.js host works. Recommended: Fly.io free tier (same as relay
variant §5.6). No companion services needed — STUN is handled by
Google's public servers.

The signaling server URL is `VITE_SIGNAL_HOST` (analogous to
`VITE_WS_HOST` in the relay variant). Local dev uses
`ws://localhost:3002`.

---

## 6. Client: `usePeerRoom` Hook

### 6.1 Purpose

Manages the full WebRTC lifecycle: signaling WebSocket, peer
connection objects, DataChannel pairs, snapshot coordination, and
the Lamport clock. Returns a `PeerRoom` object with the same
external shape as the relay variant's `Room` — `state`, `stateRef`,
`broadcast`, `onMessage` — so `useRemoteCanvas`, `GhostCursorLayer`,
and `usePartialPath` need no changes.

**Critical: `peer:left` normalization.** Downstream hooks (`usePartialPath`
ghost-path cleanup, `GhostCursorLayer` cursor cleanup) listen for
`{ type: 'peer:left', peerId }` via `onMessage`. In P2P, a peer
departure arrives two ways: a `p2p:leave` message (clean disconnect)
or a DataChannel `close` event (crash). `usePeerRoom` must normalize
both into a synthetic `{ type: 'peer:left', peerId }` emitted through
`onMessage`, so no P2P-specific handling is needed downstream.

### 6.2 API surface

```ts
// src/collab/usePeerRoom.ts — DESIGN

type PeerInfo = {
  id: string;
  operatorId: string | null;
  cursor: { x: number; y: number } | null;
};

type PeerRoomState =
  | { status: 'disconnected' }
  | { status: 'connecting' }            // signaling WS open, waiting for peers
  | { status: 'connected'; roomId: string; peerId: string;
      peers: Map<string, PeerInfo> }
  | { status: 'reconnecting'; attempt: number }
  | { status: 'awaiting-snapshot' }     // WebRTC open, snapshot not yet received
  | { status: 'error'; message: string };

type PeerRoom = {
  state: PeerRoomState;
  stateRef: React.RefObject<PeerRoomState>;
  broadcast: (msg: BroadcastMessage) => void;
  onMessage: (handler: (msg: InboundMessage) => void) => () => void;
};

function usePeerRoom(
  roomId: string | null,
  peerId: string,
  operatorId: string | null,
  canvas: fabric.Canvas | null,   // needed for snapshot serialization (eldest role)
): PeerRoom;
```

`canvas` is needed because this peer may be the eldest and must
be able to serialize the canvas on `snapshot:request`. This is the
one API difference from the relay variant's `useRoom`.

When `roomId` is `null`, returns a disconnected no-op room.

### 6.3 Internal structure

```
usePeerRoom
  │
  ├── sigWs: WebSocket              — signaling channel (to server)
  ├── peers: Map<peerId, PeerConn>
  │         └── PeerConn {
  │               rtc: RTCPeerConnection,
  │               reliable: RTCDataChannel,
  │               ephemeral: RTCDataChannel,
  │               state: 'connecting' | 'open' | 'closed'
  │             }
  ├── [lamport clock]               — module-level singleton in lamport.ts,
  │                                   not hook-owned state; imported via tick/merge/now
  ├── eldestPeerId: string | null   — snapshot authority; recomputed on peer departure
  ├── pendingDeltas: P2PMessage[]   — buffered during snapshot load
  └── snapshotReceived: boolean
```

### 6.4 Connection lifecycle

**Outgoing connections (this peer as initiator):**

1. `sig:peers` arrives from signaling server with list of existing peers.
2. For each existing peer P:
   a. Create `RTCPeerConnection({ iceServers: ICE_SERVERS })`.
   b. Create `reliable` DataChannel:
      `rtc.createDataChannel('reliable', { ordered: true })`.
   c. Create `ephemeral` DataChannel:
      `rtc.createDataChannel('ephemeral', { ordered: false, maxRetransmits: 0 })`.
      Channel labels (`'reliable'`, `'ephemeral'`) are how the answerer
      identifies them via `ondatachannel` — the names are load-bearing.
   d. Create SDP offer; set as local description; send `sig:offer` to P via signaling.
3. ICE candidates gathered by `rtc.onicecandidate` → forwarded as `sig:ice`.

**Incoming connections (this peer as answerer):**

1. `sig:offer` arrives from signaling for a new peer Q.
2. Create `RTCPeerConnection({ iceServers: ICE_SERVERS })`.
3. Set remote description; create SDP answer; send `sig:answer` to Q.
4. The answerer receives the initiator's DataChannels via `rtc.ondatachannel`.
   Identify by label: `event.channel.label === 'reliable'` or `'ephemeral'`.
   Track how many have arrived; the connection is ready when both are open
   (`channel.onopen` fired for both `reliable` and `ephemeral`).

**When a peer's DataChannels are open (per-connection, not global):**

As soon as both `reliable` and `ephemeral` channels to a specific peer
reach `open`, send `{ type: 'p2p:join', peerId, operatorId, lc: tick() }`
on that peer's `reliable` channel. This happens independently per peer —
do not wait for all peers' channels to open before sending to any of them.
The answerer side (existing peer) does NOT send a snapshot automatically;
the joiner requests it explicitly from the eldest.

**Edge case — first peer (empty room):**

If `sig:peers` returns `[]`, there are no connections to initiate and
no snapshot to request. The peer immediately transitions to `connected`
with an empty canvas. This is the room-creation path.

**Snapshot request:**

The joiner sends `{ type: 'snapshot:request' }` on the reliable channel
to the eldest peer as soon as that specific DataChannel reaches `open` —
it does not wait for all other peer channels to open first. The joiner
then transitions to `awaiting-snapshot`. Incoming deltas from any peer
during this window are queued in `pendingDeltas`.

A **10-second timeout** fires if `snapshot:done` never arrives (eldest
peer stalled or lost connection mid-transfer). On timeout: close the
connection to the current eldest, promote next-oldest peer as new
eldest, reset the chunk accumulator, and re-send `snapshot:request` to
the new eldest. If no more peers exist, transition to `connected` with
an empty canvas and a warning toast: "Couldn't receive canvas — start
fresh or rejoin."

**Snapshot serving (eldest peer):**

On `snapshot:request`:
1. Guard: if `canvas === null` (hook mounted before canvas ref is ready),
   respond immediately with `{ type: 'snapshot:done', lc: now() }` and an
   empty chunk — the joiner gets an empty canvas and will receive subsequent
   deltas normally. In practice this race is unlikely since `usePeerRoom`
   receives `snapshot:request` only after `usePeerRoom` is already wired
   to a mounted canvas in App.tsx.
2. Call `canvas.toJSON(['__id', '__operatorId', '__phase', '__seq', '__markType', '__arrowTip'])`.
3. Split `.objects` array into chunks of ≤ 60 KB serialized.
4. Send each chunk as `{ type: 'snapshot:chunk', index, total, canvas: chunk }`.
5. Send `{ type: 'snapshot:done', lc: now() }`.

**Snapshot apply (new joiner):**

1. Accumulate `snapshot:chunk` messages.
2. On `snapshot:done`: assemble full canvas array, call `withRemote(() => canvas.loadFromJSON(...))`.
3. In `.then()`: set `lamport = max(lamport, snapshot.lc) + 1`.
4. Apply `pendingDeltas` with `lc > snapshot.lc` in Lamport order.
5. Clear `pendingDeltas`; set `snapshotReceived = true`; transition to `connected`.

### 6.5 Broadcast fan-out

```ts
// Returns the lc value stamped into the message frame (undefined for ephemeral).
// Callers that write __lc on the local canvas object MUST use this return value —
// calling tick() separately before broadcast() would produce a different lc
// (clock increments twice), causing the local __lc and the sent lc to diverge.
// A diverged __lc breaks LWW: the local peer checks msg.lc > __lc but __lc is
// one step behind what was actually broadcast, so a simultaneous remote modify
// always wins even when it shouldn't.
broadcast(msg: BroadcastMessage): number | undefined {
  const channel = isEphemeral(msg.type) ? 'ephemeral' : 'reliable';
  // lc: undefined on ephemeral messages — JSON.stringify silently drops
  // undefined values, so the key is simply absent from the frame. Correct.
  const lc = isEphemeral(msg.type) ? undefined : tick();
  const frame = JSON.stringify({ ...msg, peerId, lc });

  for (const conn of peers.values()) {
    const dc = channel === 'reliable' ? conn.reliable : conn.ephemeral;
    if (dc.readyState === 'open') {
      dc.send(frame);
    }
  }
  return lc;
}

function isEphemeral(type: string): boolean {
  return type === 'cursor' || type === 'path:stroke' || type === 'path:commit';
}
```

Ephemeral messages skip Lamport clock increment (they are not
order-sensitive).

### 6.6 Reconnection

If a peer's `RTCPeerConnection` closes unexpectedly (network loss,
tab background-throttled):

1. `onconnectionstatechange` fires. Treat states differently:
   - `'disconnected'` — transient; wait 5 s before acting (mobile networks
     recover automatically on tower switch). If still `'disconnected'`
     after 5 s, treat as `'failed'`.
   - `'failed'` — definitive; immediately attempt reconnect.
2. Attempt to re-establish: send a fresh `sig:offer` to that peer via
   signaling WS (if signaling WS is still open).
3. If the signaling WS itself is closed (e.g., server restart),
   reconnect to signaling first (exponential backoff), then re-mesh.
4. Re-request snapshot only if **all** peer connections were lost
   simultaneously (full mesh collapse — `peers.size === 0` after all
   close events fire). For a single-peer disconnect, the local canvas
   is still valid; no snapshot needed, just re-mesh with that one peer.

If all connections are lost simultaneously (network outage), the
reconnection path is the same as a fresh join: signaling reconnect →
mesh rebuild → snapshot from eldest.

`eldestPeerId` must be kept current as peers leave: on any `p2p:leave`
or DataChannel `close` event, remove that peer from the candidate list
and recompute eldest as the remaining peer with the lowest `joinedAt`
from `sig:peers`. This matters during snapshot fallback (§6.4 timeout
path) and if a reconnect triggers a fresh snapshot request.

### 6.7 Clean disconnect

On `useEffect` cleanup (unmount) or `beforeunload`:

1. For each peer connection: send `{ type: 'p2p:leave', peerId }` on
   reliable channel; close the DataChannels and `RTCPeerConnection`.
2. Send `{ type: 'sig:leave', peerId }` on signaling WS; close it.

The signaling server's `ws.on('close')` handles crash disconnects
(fires regardless of clean close) and broadcasts `sig:left` to
remaining peers, who then close their connection to the departed peer.

---

## 7. Client: Remote Delta Application (`useRemoteCanvas`)

### 7.1 Undo bypass: `applyingRemote` module flag

**Identical to relay variant §7.1.** The `applyingRemote` flag,
`withRemote()`, `isApplyingRemote()`, and the three `useUndo` guards
are unchanged. The transport layer is abstracted by `onMessage()`.

### 7.2 API surface

```ts
function useRemoteCanvas(
  canvas: fabric.Canvas | null,
  room: PeerRoom,       // was Room in relay variant — same shape
  unerasable: Set<string>,
  peerId: string,       // local peer's id — used for __lastModifiedBy LWW tracking
): void;
```

`PeerRoom` has the same `onMessage` API as relay variant's `Room`.
`peerId` is new vs. the relay variant — needed because the relay variant used
server-stamped wall-clock timestamps without a peer tie-break, so `__lastModifiedBy`
tracking wasn't required. The P2P Lamport LWW tie-break (§4.2) requires it.

### 7.3 Applying `delta:added`

**Identical to relay variant §7.3.** `enlivenObjects` Promise-based
(fabric v7 API); idempotency double-check after async gap.

### 7.4 Applying `delta:modified`

Same structure as relay variant §7.4, but the conflict check uses
the **Lamport clock** instead of server wall-clock timestamp:

```ts
room.onMessage(msg => {
  if (msg.type !== 'delta:modified') return;

  const target = canvas.getObjects().find(o => (o as any).__id === msg.id);
  if (!target) return;

  // Lamport LWW: higher lc wins; tie-break by peerId (deterministic).
  const localLc: number = (target as any).__lc ?? 0;
  const localOwner: string = (target as any).__lastModifiedBy ?? '';
  if (msg.lc < localLc) return;
  if (msg.lc === localLc && msg.peerId < localOwner) return;

  if (msg.isGroup) {
    fabric.util.enlivenObjects([msg.patch]).then(([newObj]) => {
      const current = canvas.getObjects().find(o => (o as any).__id === msg.id);
      if (!current) return;
      // Set __lc before adding — without this the next delta:modified sees
      // __lc = 0 on the freshly-swapped object and always wins regardless of age.
      (newObj as any).__lc = msg.lc;
      (newObj as any).__lastModifiedBy = msg.peerId;
      withRemote(() => {
        canvas.remove(current);
        canvas.add(newObj);
        canvas.requestRenderAll();
      });
    });
  } else {
    withRemote(() => {
      target.set(msg.patch);
      target.setCoords();
      (target as any).__lc = msg.lc;
      (target as any).__lastModifiedBy = msg.peerId;
      canvas.requestRenderAll();
    });
  }
});
```

### 7.5 Applying `delta:removed`

**Identical to relay variant §7.5** — `if (!target) return` no-op
guard handles the simultaneous-delete case.

### 7.6 Broadcasting local actions

**Identical to relay variant §7.6** — named handler refs, same
`isApplyingRemote()` guard, same `REPLAY`/`TRANSIENT` guards.
The only difference: `room.broadcast(...)` fans out to all peers
via DataChannel instead of one WebSocket to the server.

Outgoing `delta:modified` messages write `__lc = lamport.now()` on
the local object before calling `room.broadcast`, matching the
incoming path's `__lc` tracking:

```ts
const onModified = ({ target }) => {
  if (isApplyingRemote()) return;
  if (isFlagged(target, REPLAY) || isFlagged(target, TRANSIENT)) return;
  const isGroup = target instanceof fabric.Group;
  // broadcast() calls tick() internally and returns the lc stamped into the frame.
  // Store that exact value as __lc — do NOT call tick() here separately.
  // A separate tick() would increment the clock twice: local __lc = N, sent lc = N+1.
  // The diverged __lc breaks LWW convergence (see broadcast() contract in §6.5).
  const lc = room.broadcast({
    type: 'delta:modified',
    id: (target as any).__id,
    isGroup,
    patch: isGroup
      ? target.toObject([...FABRIC_EXTRAS])
      : target.toObject(['left', 'top', 'scaleX', 'scaleY', 'angle']),
  });
  (target as any).__lc = lc;
  (target as any).__lastModifiedBy = peerId;
};
```

---

## 8. Partial-Path Streaming (`usePartialPath`)

`path:stroke` and `path:commit` travel over the `ephemeral` DataChannel
(unordered, no retransmit) rather than the signaling WebSocket. Frame loss
is acceptable — a dropped stroke-update shows as a momentary stall in the
ghost path, not an inconsistency.

The `withRemote` wrapping, `__peerId`/`__ghostId` on ghost paths, and
`peer:left` cleanup (§8.4 of relay doc) are all unchanged.

### 8.1 Bandwidth-optimized sending (implemented)

The sender sends **delta-only** points each frame rather than the full
growing array, and throttles at **~30 fps** (33 ms) instead of 60 fps.
Coordinate values are rounded to 1 decimal place before serializing.

```ts
// Sender tracks lastSentCount per stroke; resets on mouse:down.
const newPts = pts.slice(lastSentCount);
if (newPts.length === 0) return;
lastSentCount = pts.length;

broadcast({
  type: 'path:stroke',
  id: activePathId.current,
  points: newPts.flatMap(p => [
    Math.round(p.x * 10) / 10,
    Math.round(p.y * 10) / 10,
  ]),
  ...
});
```

The `path:stroke` wire format (`points: number[]`) is unchanged — receivers
that accumulate correctly do not need a protocol version bump.

### 8.2 Receiver accumulation

Because the sender now sends deltas, the receiver maintains a
`strokePoints: Map<strokeId, fabric.Point[]>` accumulator alongside the
existing `ghostPaths` registry. Each incoming `path:stroke` appends its
new points to the accumulator; the ghost Polyline is rebuilt from the full
accumulated array. Both `path:commit` and `peer:left` clear the accumulator
entry alongside the ghost registry entry.

### 8.3 Impact

A 3-second stroke at typical drawing speed generates ~300 brush points.
- **Before:** last frame sends all 300 points (~600 bytes/frame at 60 fps)
- **After:** each frame sends only the ~5 new points since the last frame
  (~30 bytes/frame at 30 fps)
- Combined reduction: **~95% less path:stroke traffic**

> **Check C and Check D from relay variant §8 apply here identically.**
> Spike the `fabric.Polyline` live-update path and confirm
> `PencilBrush._points` field name before coding.

---

## 9. Ghost Cursors

HTML overlay, `viewportTransform` prop, 30 fps broadcast throttle, 2 s fade.
Cursor messages go over the `ephemeral` channel.

Two bandwidth micro-optimizations are applied on top of the relay variant design:

- **Dead-zone guard** — cursor send is skipped if the canvas-space position
  hasn't changed by more than 2 px in either axis since the last broadcast.
  This eliminates traffic when the mouse is stationary or nearly so (hovering,
  reading the map) while the mousemove events still fire at high frequency.
- **Coordinate rounding** — `x` and `y` are rounded to 1 decimal place before
  broadcasting. Sub-pixel precision is unnecessary for ghost cursor rendering.

---

## 10. Operator Chip Ownership

**Identical to relay variant §10.** `chip:claim` / `chip:release`
travel over the `reliable` channel (with Lamport clock) so the
ownership state converges correctly across all peers. The
simultaneous-claim no-conflict semantic (§10.2) is unchanged.

---

## 11. UI Additions

### 11.1 Room URL bar (`<RoomBar />`)

Same as relay variant §11.1, with one new state:

- **awaiting-snapshot** — `◑ receiving canvas…` (blue, pulsing)
  Shown while the new joiner is receiving the snapshot from the
  eldest peer.

Updated persistence note: "Canvas lives in connected browsers only.
If everyone leaves, the canvas is gone. Export to save permanently."
(stronger than relay variant because there is no server-side TTL
buffer — canvas is gone immediately when the last peer leaves.)

### 11.2 Join flow

Same as relay variant §11.2 with one wording change: the relay
variant says "Room not found or expired" (rooms had a 24h TTL). In
P2P there is no TTL — the signaling room disappears immediately when
the last peer leaves. The message should read: "Room not found. It
may have ended when all players left." The `[Start new room]` fallback
is unchanged.

### 11.3 Peer count

Identical to relay variant §11.3.

---

## 12. Modified and New Files

### 12.1 New files

```
signaling-server/               (replaces server/)
  package.json                  (name: debrief-signaling)
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    (HTTP + WS signaling server, ~150 lines)
    rooms.ts                    (SigRoom model, no canvas state)
    rooms.test.ts

src/
  collab/
    protocol.ts                 (updated — P2P message types)
    lamport.ts                  (Lamport clock module)
    iceServers.ts               (STUN-only config — Google public servers, no env vars)
    usePeerRoom.ts              (replaces useRoom.ts)
    usePeerRoom.test.ts
    useRemoteCanvas.ts          (adapted from relay variant — Lamport LWW conflict
                                  check instead of wall-clock; peerId parameter added)
    useRemoteCanvas.test.ts     (add Lamport conflict test cases)
    usePartialPath.ts           (unchanged from relay variant)
    usePartialPath.test.ts      (unchanged)
    GhostCursorLayer.tsx        (unchanged)
    GhostCursorLayer.css        (unchanged)
    GhostCursorLayer.test.tsx   (unchanged)
    remoteFlag.ts               (unchanged — applyingRemote module flag)
  components/
    RoomBar.tsx                 (add 'awaiting-snapshot' state)
    RoomBar.css
    RoomBar.test.tsx
```

### 12.2 Modified files

| File | Change vs. relay variant |
|---|---|
| `src/tools/undo.ts` | Same change as relay variant — `isApplyingRemote()` guards in `onAdd`, `onRemove`, `onModified` |
| `src/App.tsx` | Wire `usePeerRoom` instead of `useRoom`; pass `canvas` to hook; rest identical to relay variant |
| `src/components/OperatorChips.tsx` | Identical to relay variant — `peers` prop, owner badges |
| `pnpm-workspace.yaml` | `signaling-server` instead of `server` |
| `.github/workflows/ci.yml` | `signaling-server` typecheck + test |
| `vite.config.js` | `VITE_SIGNAL_HOST` |

### 12.3 Deleted files (vs. relay variant)

`server/` is replaced entirely by `signaling-server/`. The relay
variant's `server/src/rooms.ts` (canvas mirror, TTL, LWW logic) has
no counterpart — that logic moves client-side (Lamport clocks in
`useRemoteCanvas`, snapshot in `usePeerRoom`).

### 12.4 Tech debt queued (not in P3)

- TURN server (if a squad member on symmetric NAT is a recurring problem).
- Chunked snapshot progressive apply for large canvases (> 300 objects).
- Peer-to-peer reconnection without signaling server (LAN discovery via mDNS).
- Lamport clock overflow guard (at 2^53 − 1, practically unreachable).
- SFU (Selective Forwarding Unit) topology if squad sizes exceed 5.

---

## 13. Sequencing (P3.1 → P3.5)

**P3.1 — Signaling server + `usePeerRoom` + `<RoomBar />`.**
Ship `signaling-server/`, the `usePeerRoom` hook, `lamport.ts`,
`iceServers.ts`, and `<RoomBar />`. No canvas sync yet. Test: two
browser tabs connect; `<RoomBar />` shows "2 peers connected."

**P3.2 — Remote delta application.**
Land `useRemoteCanvas` (adapted conflict check to Lamport), the
broadcast effect in App.tsx. Test: same as relay variant P3.2.

**P3.3 — Ghost cursors.**
Identical to relay variant P3.3.

**P3.4 — Partial-path streaming.**
Identical to relay variant P3.4. Verify ephemeral DataChannel
delivers stroke updates with acceptable loss rate (a few dropped
frames is fine; consistent loss is not).

**P3.5 — Operator chip claims + join flow.**
Identical to relay variant P3.5.

---

## 14. Risk Register

### P2P-specific risks (new or materially changed)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1-P2P | Peer behind symmetric NAT cannot establish DataChannel | Low | Hard limitation by design — no TURN server. Surface "direct connection failed, try a home network" message. Acceptable: target squad uses home/LAN networks. |
| R2-P2P | Eldest peer disconnects during snapshot transfer | High | Receiver detects channel close mid-transfer; requests snapshot from next-oldest peer; resets chunk accumulator |
| R3-P2P | Signaling server down: new peers cannot join | Med | Existing mesh continues operating; new joins blocked until signaling recovers. Document: "Existing sessions unaffected by signaling restart." |
| R4-P2P | Lamport clock diverges after network partition + rejoin | Med | On reconnect, `merge(snapshot.lc)` re-synchronizes the clock. The worst case (two partitions independently modify the same object) resolves deterministically via the peerId tie-break. |
| R5-P2P | `delta:modified` conflict: both peers believe they won | Low | Lamport LWW + peerId tie-break is applied identically on every peer; all peers converge to the same state. No split-brain possible. |
| R6-P2P | Snapshot chunk arrives out of order on DataChannel | Low | Reliable DataChannel is ordered; chunks always arrive in send order. The `index` field is defensive, not load-bearing. |
| R7-P2P | Canvas snapshot too large to transfer in DataChannel frames | Med | Chunk at 60 KB; accumulate on receiver. Chrome DataChannel max message is 256 KB; chunking provides 4× headroom. |
| R8-P2P | Multiple peers simultaneously try to send snapshot to same new joiner | Low | Not possible. DataChannels are point-to-point pipes — `snapshot:request` is sent only on the DataChannel to the eldest peer; other peers' channels never receive it. |
| R9-P2P | Ephemeral DataChannel frame loss causes ghost path to freeze mid-draw | Low | Acceptable — ghost path stalls for one dropped frame interval (~33 ms at 30 fps), then resumes. No consistency impact. |
| R10-P2P | `RTCPeerConnection` not garbage-collected after close | Med | Explicitly call `rtc.close()` on every `RTCPeerConnection` in cleanup (and `dc.close()` on each DataChannel first); verify in `usePeerRoom.test.ts` that no connections remain open on unmount |
| R11-P2P | Signaling WebSocket blocked by mixed-content policy | Med | Client is served over HTTPS (`debrief.jrkt.dev`); browsers block `ws://` from HTTPS pages. `VITE_SIGNAL_HOST` must use `wss://` in production. WebRTC DataChannels themselves are peer-to-peer and unaffected by mixed-content rules. |

### Risks inherited from relay variant (unchanged)

| Relay # | Risk | Mitigation change |
|---|---|---|
| R2 | Simultaneous delete of same object | Identical — `if (!target) return` guard |
| R4 | Ghost paths not cleaned up on disconnect | Identical — `peer:left` handler |
| R5 | Local undo re-adds remotely deleted object | Identical |
| R7 | `PencilBrush._points` field name | Identical — Check D spike |
| R8 | Ghost cursor misaligns after pan/zoom | Identical — `viewportTransform` prop |
| R13 | `toObject` extras silently dropped | Identical — serialize round-trip test |
| R14 | `delta:modified` for fabric Group crashes | Identical — `isGroup` flag + `enlivenObjects` swap |
| R15 | Broadcast effect cleanup nukes all fabric event handlers | Identical — named handler refs |
| R17 | Snapshot load triggers broadcast of all loaded objects | Identical — `withRemote` wraps `loadFromJSON` |
| R19 | Tab close skips cleanup | Identical — `beforeunload` listener |
| R21 | `enlivenObjects` async gap double-add | Identical — second idempotency check |

---

## 15. Validation Checklist

All items from relay variant §15 apply. P2P-specific additions:

**P3.1 (Signaling + usePeerRoom + RoomBar)**
- [ ] Manual: two tabs in same room → `<RoomBar />` shows "2 peers connected"
- [ ] Manual: one tab closes → other shows "1 peer"
- [ ] Manual: "Start new room" copies URL; first tab shows "1 peer (just you)" immediately without requesting a snapshot (empty-room path)
- [ ] Manual: second tab joins → receives snapshot via DataChannel, canvas matches first tab
- [ ] **Manual: signaling server restarted while room active → existing DataChannels survive (no reconnect needed); new joins blocked until signaling recovers** (R3-P2P)
- [ ] **Manual: eldest peer closes tab mid-snapshot → 10 s timeout fires → next peer serves snapshot → new joiner receives correct canvas** (R2-P2P)
- [ ] **Manual: confirm ICE error surfaces "direct connection failed" message when connection cannot be established** (R1-P2P)

**P3.2 (Remote delta application)**
- [ ] Manual: draw in tab 1 → stroke appears in tab 2 (via DataChannel, no server relay)
- [ ] Manual: draw simultaneously in both tabs → Lamport LWW resolves any modify conflict
- [ ] **Manual: both tabs modify the same object at the same time → one wins deterministically; no crash; both tabs show the same final state** (R4-P2P, R5-P2P)
- [ ] All relay variant P3.2 checks apply

**P3.3–P3.5 (Ghost cursors, partial path, chip claims)**
- Same as relay variant; no P2P-specific additions beyond verifying the ephemeral DataChannel delivers cursor and stroke updates

---

## 16. Open Questions for User Observation

All five questions from relay variant §16 apply. P2P-specific additions:

6. **Symmetric NAT in practice.** The design accepts that peers on
   corporate/university networks cannot connect. Validate with the
   actual squad: if any member consistently hits "direct connection
   failed," check the browser's `chrome://webrtc-internals` ICE
   candidate log — if only `host` candidates appear (no `srflx`),
   their router is the problem. The fix is to use a home network or
   phone hotspot, not to add a TURN server.

7. **Snapshot transfer latency for a full debrief canvas.** A 5-minute
   debrief might generate 200–400 objects. Time a snapshot serialization
   + DataChannel transfer on a typical squad member's machine and network.
   If > 2 s, add a progress indicator ("Receiving canvas… 60%") to
   `<RoomBar />`.

8. **Canvas loss on last-peer-leaves.** The relay variant had a 24 h
   TTL buffer (server held the canvas). The P2P variant has zero
   buffer — if the last peer closes their tab, the canvas is gone.
   Validate: does the squad actually want this stricter ephemeral
   behavior, or is the "come back tomorrow" pattern real enough to
   warrant adding a local `localStorage` export-on-unload fallback?

---

## 17. Trade-off Summary vs. Relay Variant

| Dimension | P2P variant wins | Relay variant wins |
|---|---|---|
| Server complexity | ✓ Signaling-only (~150 lines) vs. relay (~300 lines + canvas mirror) | |
| Canvas privacy | ✓ Server never sees canvas objects | |
| Server restart resilience | ✓ Existing mesh survives signaling restart | |
| Canvas persistence across all-disconnect | | ✓ 24 h TTL on relay server |
| Corporate NAT support | | ✓ Server has stable IP; symmetric NAT peers connect fine |
| Join latency | | ✓ Relay: instant snapshot from server. P2P: DataChannel setup + peer transfer (adds ~500 ms) |
| Conflict resolution robustness | Comparable — relay uses server wall clock; P2P uses Lamport. Both are correct. | |
| Scalability ceiling | Comparable at P3 scale; P2P hits full-mesh limits at ~10 peers | |

For a squad debrief tool (2–5 players, home/LAN networks, single
session use), the P2P variant's reduced server complexity and canvas
privacy are compelling advantages. The relay variant's 24 h TTL and
guaranteed NAT traversal are compelling if the squad uses corporate
networks or frequently returns to past sessions.

---

## 18. Boundary

This document defines the design for the P2P variant. It does not
ship code. Implementation should follow P3.1–P3.5 sequencing (§13),
validate against §15, and resolve §16 before marking P3 complete.
The signaling server must be deployed (§5.7) before P3.1 can be
integration-tested. No TURN server is needed — STUN via Google's
public servers covers the target home/LAN environment.
