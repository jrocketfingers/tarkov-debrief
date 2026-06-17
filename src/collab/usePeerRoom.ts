/* eslint-disable @typescript-eslint/no-explicit-any */
// WebRTC P2P room hook — Trystero/Nostr variant.
//
// Replaces the custom signaling-server + native RTCPeerConnection approach
// with Trystero (trystero/nostr), which uses public Nostr relays for signaling.
// No server to host. Canvas data still travels P2P via WebRTC DataChannels
// managed by Trystero internally.
//
// External API shape is identical to the relay useRoom hook:
//   broadcast(msg: BroadcastMessage) => number | undefined
//   onMessage(handler) => () => void
//   state: PeerRoomState
//   stateRef: React.RefObject<PeerRoomState>
//
// Two Trystero actions replace the two native DataChannels from the earlier
// implementation (both are reliable DataChannels internally; the distinction
// is semantic — ephemeral messages skip the Lamport clock):
//   'reliable'  — carries delta:*, snapshot:*, chip:*, p2p:join/leave
//   'ephemeral' — carries cursor, path:stroke, path:commit
//
// Eldest-peer / snapshot coordination without a signaling server:
//   Each p2p:join frame includes joinedAt: Date.now(). The peer with the
//   smallest joinedAt is the snapshot authority. A 4-second timer handles
//   the "first peer in empty room" case where no onPeerJoin fires.
//
// ID mapping: Trystero assigns its own internal peer IDs per session.
//   App-level peer IDs (sessionStorage UUIDs) are exchanged via p2p:join and
//   stored in trysteroToAppRef / appToTrysteroRef so that targeted snapshot
//   sends (which need a Trystero peer ID as the `target` option) can be
//   looked up by app peer ID.
//
// Design reference: claudedocs/design_p3_multiplayer_p2p.md §6

import { useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { joinRoom } from 'trystero/nostr';
import { setApplyingRemote } from './remoteFlag';
import { EXTRAS } from './useRemoteCanvas';
import { tick, merge } from './lamport';
import { ICE_SERVERS } from './iceServers';
import type { BroadcastMessage, InboundMessage, PeerInfo } from './protocol';

// Retrieves or generates the local peer ID from sessionStorage. Using
// sessionStorage (not localStorage) ensures a fresh peer ID per browser tab —
// two tabs opened to the same room will appear as two distinct peers. §6.1
export function getOrCreatePeerId(): string {
  const stored = sessionStorage.getItem('tarkov-debrief:peerId');
  if (stored) return stored;
  const id = crypto.randomUUID();
  sessionStorage.setItem('tarkov-debrief:peerId', id);
  return id;
}

// ---- P2P-internal wire types (not exported) --------------------------------

type P2PWireMessage =
  | { type: 'p2p:join'; peerId: string; operatorId: string | null; joinedAt: number; lc: number }
  | { type: 'p2p:leave'; peerId: string; lc: number }
  | { type: 'delta:added'; peerId: string; obj: Record<string, unknown>; lc: number }
  | { type: 'delta:modified'; peerId: string; id: string; isGroup: boolean; patch: Record<string, unknown>; lc: number }
  | { type: 'delta:removed'; peerId: string; id: string; lc: number }
  | { type: 'snapshot:request'; peerId: string }
  | { type: 'snapshot:chunk'; peerId: string; index: number; total: number; canvas: Record<string, unknown>[] }
  | { type: 'snapshot:done'; peerId: string; lc: number }
  | { type: 'chip:claim'; peerId: string; operatorId: string; lc: number }
  | { type: 'chip:release'; peerId: string; operatorId: string; lc: number }
  | { type: 'cursor'; peerId: string; x: number; y: number }
  | { type: 'path:stroke'; peerId: string; id: string; operatorId: string | null; phase: 'plan' | 'record'; points: number[] }
  | { type: 'path:commit'; peerId: string; id: string };

// Trystero action handle with typed send and settable onMessage.
type TrysteroAction = {
  send: (data: string, options?: { target?: string | string[] | null }) => Promise<void>;
  onMessage: ((data: string, context: { peerId: string }) => void) | null;
};

// Ephemeral messages skip the Lamport clock — they are order-insensitive and
// tolerable to lose. §4.1
function isEphemeral(type: string): boolean {
  return type === 'cursor' || type === 'path:stroke' || type === 'path:commit';
}

// ---- Public types ----------------------------------------------------------

export type PeerRoomState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'awaiting-snapshot' }
  | { status: 'connected'; roomId: string; peerId: string; peers: Map<string, PeerInfo> }
  | { status: 'reconnecting'; attempt: number }
  | { status: 'error'; message: string };

export type PeerRoom = {
  state: PeerRoomState;
  // Stable ref-mirror of state; safe to read in event handlers and effects.
  stateRef: React.RefObject<PeerRoomState>;
  // Returns the Lamport lc stamped into the frame (undefined for ephemeral msgs).
  // Callers that set __lc on local canvas objects MUST use this return value —
  // see §6.5 for why a separate tick() call before broadcast() would break LWW.
  broadcast: (msg: BroadcastMessage) => number | undefined;
  onMessage: (handler: (msg: InboundMessage) => void) => () => void;
};

// ---- Hook ------------------------------------------------------------------

export function usePeerRoom(
  roomId: string | null,
  peerId: string,
  operatorId: string | null,
  canvas: fabric.Canvas | null,
): PeerRoom {
  const [roomState, setRoomState] = useState<PeerRoomState>({ status: 'disconnected' });

  // stateRef is updated on every render so event handlers read fresh state
  // without closing over stale values. §6.3 ref-mirror pattern.
  const stateRef = useRef<PeerRoomState>({ status: 'disconnected' });
  stateRef.current = roomState;

  // Stable refs — never recreated, safe to read from async callbacks.
  const messageHandlersRef = useRef<Set<(msg: InboundMessage) => void>>(new Set());

  // Trystero action send functions; null between effect runs.
  const reliableSendRef = useRef<TrysteroAction['send'] | null>(null);
  const ephemeralSendRef = useRef<TrysteroAction['send'] | null>(null);

  // Trystero assigns its own internal peer IDs. App-level IDs (session UUIDs)
  // are exchanged via p2p:join. Both directions are tracked so targeted
  // snapshot sends (which need a Trystero ID) can be resolved by app peer ID.
  const trysteroToAppRef = useRef<Map<string, string>>(new Map());
  const appToTrysteroRef = useRef<Map<string, string>>(new Map());

  // peerInfoRef mirrors the PeerInfo we'd put in connected.peers; used to
  // build the peers Map in finishSnapshot and to update it on chip/cursor msgs.
  const peerInfoRef = useRef<Map<string, PeerInfo>>(new Map());
  const joinedAtRef = useRef<Map<string, number>>(new Map()); // from p2p:join.joinedAt
  const eldestPeerIdRef = useRef<string | null>(null);

  // myJoinedAt: timestamp when we called joinRoom for this session. Compared
  // against remote joinedAt values to determine eldest-peer role. §6.4
  const myJoinedAtRef = useRef<number>(0);
  // True once a p2p:join with remoteJoinedAt < myJoinedAt arrives, meaning
  // at least one peer is older than us and will serve the snapshot.
  const hasOlderPeerRef = useRef<boolean>(false);
  // True once we've sent snapshot:request so we don't send it a second time
  // if a second older peer's p2p:join arrives before the snapshot completes.
  const snapshotRequestedRef = useRef<boolean>(false);

  const snapshotChunksRef = useRef<Record<string, unknown>[][]>([]);
  const snapshotTotalRef = useRef<number>(0);
  const pendingDeltasRef = useRef<P2PWireMessage[]>([]);
  const snapshotReceivedRef = useRef<boolean>(false);
  const snapshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fires after 4 s if no onPeerJoin ever fires — we are the first peer.
  const firstPeerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref-mirrors for values that change without triggering hook re-creation.
  const canvasRef = useRef<fabric.Canvas | null>(null);
  canvasRef.current = canvas;
  const operatorIdRef = useRef<string | null>(null);
  operatorIdRef.current = operatorId;
  const peerIdRef = useRef<string>(peerId);
  peerIdRef.current = peerId;
  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = roomId;

  // ---- Stable public API --------------------------------------------------

  const onMessage = useCallback((handler: (msg: InboundMessage) => void): (() => void) => {
    messageHandlersRef.current.add(handler);
    return () => messageHandlersRef.current.delete(handler);
  }, []);

  const broadcast = useCallback((msg: BroadcastMessage): number | undefined => {
    // tick() here for reliable messages. Ephemeral messages skip the Lamport
    // clock — they're order-insensitive and tolerable to drop. §4.2
    const lc = isEphemeral(msg.type) ? undefined : tick();
    const frame = JSON.stringify({ ...msg, peerId: peerIdRef.current, lc });
    const sendFn = isEphemeral(msg.type) ? ephemeralSendRef.current : reliableSendRef.current;
    sendFn?.(frame).catch((err) => console.error('[p2p] broadcast send error:', err));
    return lc;
  }, []);

  // ---- Main lifecycle effect ----------------------------------------------

  useEffect(() => {
    if (!roomId) {
      setRoomState({ status: 'disconnected' });
      return;
    }

    let active = true;

    // Reset per-room state for a fresh join.
    peerInfoRef.current.clear();
    joinedAtRef.current.clear();
    trysteroToAppRef.current.clear();
    appToTrysteroRef.current.clear();
    eldestPeerIdRef.current = null;
    hasOlderPeerRef.current = false;
    snapshotRequestedRef.current = false;
    snapshotChunksRef.current = [];
    snapshotTotalRef.current = 0;
    pendingDeltasRef.current = [];
    snapshotReceivedRef.current = false;
    myJoinedAtRef.current = Date.now();
    if (snapshotTimeoutRef.current !== null) { clearTimeout(snapshotTimeoutRef.current); snapshotTimeoutRef.current = null; }
    if (firstPeerTimerRef.current !== null) { clearTimeout(firstPeerTimerRef.current); firstPeerTimerRef.current = null; }

    setRoomState({ status: 'connecting' });

    // ---- Local helpers (defined inside effect to close over `active`) ----

    function dispatch(msg: InboundMessage): void {
      messageHandlersRef.current.forEach((h) => h(msg));
    }

    function recomputeEldest(): void {
      let eldestId: string | null = null;
      let eldestTime = Infinity;
      for (const [id, ts] of joinedAtRef.current) {
        // Only consider peers we have confirmed via p2p:join (in peerInfoRef).
        if (peerInfoRef.current.has(id) && ts < eldestTime) {
          eldestId = id;
          eldestTime = ts;
        }
      }
      eldestPeerIdRef.current = eldestId;
    }

    function handlePeerLeft(departedAppPeerId: string): void {
      if (!peerInfoRef.current.has(departedAppPeerId)) return; // idempotent

      peerInfoRef.current.delete(departedAppPeerId);
      joinedAtRef.current.delete(departedAppPeerId);
      appToTrysteroRef.current.delete(departedAppPeerId);
      recomputeEldest();

      setRoomState((prev) => {
        if (prev.status !== 'connected') return prev;
        const newPeers = new Map(prev.peers);
        newPeers.delete(departedAppPeerId);
        return { ...prev, peers: newPeers };
      });
      dispatch({ type: 'peer:left', peerId: departedAppPeerId, ts: Date.now() } as unknown as InboundMessage);
    }

    function serveSnapshot(requesterAppPeerId: string): void {
      const trysteroId = appToTrysteroRef.current.get(requesterAppPeerId);
      const sendFn = reliableSendRef.current;
      if (!trysteroId || !sendFn) return;

      const cv = canvasRef.current;
      const CHUNK_BYTES = 60 * 1024;

      if (!cv) {
        // Canvas not mounted — send empty snapshot so joiner isn't stuck. §6.4
        sendFn(
          JSON.stringify({ type: 'snapshot:done', peerId: peerIdRef.current, lc: tick() }),
          { target: trysteroId },
        ).catch(() => {});
        return;
      }

      // canvas.toJSON(customProps) in fabric v7 ignores the custom-properties
      // argument — it calls obj.toObject() with no args internally. Using
      // obj.toObject(EXTRAS) directly on each object is the pattern that works
      // (same as the delta broadcast in App.tsx). §fabric-v7 toJSON limitation.
      //
      // Only annotation objects carry __id. The map image has no __id and
      // should be loaded independently by each peer from its URL. §6.4
      const objects: Record<string, unknown>[] = cv.getObjects()
        .map((o) => (o as any).toObject(EXTRAS))
        .filter((o: any) => o.__id !== undefined);

      const chunks: Record<string, unknown>[][] = [];
      let cur: Record<string, unknown>[] = [];
      let curSize = 0;
      for (const obj of objects) {
        const s = JSON.stringify(obj).length;
        if (curSize + s > CHUNK_BYTES && cur.length > 0) { chunks.push(cur); cur = []; curSize = 0; }
        cur.push(obj);
        curSize += s;
      }
      chunks.push(cur); // always at least one (may be empty)

      const total = chunks.length;
      for (let i = 0; i < total; i++) {
        sendFn(
          JSON.stringify({ type: 'snapshot:chunk', peerId: peerIdRef.current, index: i, total, canvas: chunks[i] }),
          { target: trysteroId },
        ).catch(() => {});
      }
      sendFn(
        JSON.stringify({ type: 'snapshot:done', peerId: peerIdRef.current, lc: tick() }),
        { target: trysteroId },
      ).catch(() => {});
    }

    async function finishSnapshot(snapLc: number): Promise<void> {
      if (!active) return;
      if (snapshotTimeoutRef.current !== null) { clearTimeout(snapshotTimeoutRef.current); snapshotTimeoutRef.current = null; }

      const cv = canvasRef.current;
      const chunks = snapshotChunksRef.current;
      const total = snapshotTotalRef.current;
      const allObjects: Record<string, unknown>[] = [];
      for (let i = 0; i < total; i++) { if (chunks[i]) allObjects.push(...chunks[i]); }

      if (cv && allObjects.length > 0) {
        // Set flag before the async gap so the broadcast effect skips canvas.add
        // calls fired by enlivenObjects. §4.5
        setApplyingRemote(true);
        try {
          const toRemove = cv.getObjects().filter((o) => !!(o as any).__id);
          for (const obj of toRemove) cv.remove(obj as fabric.FabricObject);
          const enlivened = await fabric.util.enlivenObjects(allObjects as Record<string, unknown>[]);
          if (!active) return;
          // Idempotency: pending deltas may have added some objects during enliven.
          const existingIds = new Set(cv.getObjects().map((o) => (o as any).__id as string | undefined).filter(Boolean));
          for (const raw of enlivened) {
            const obj = raw as fabric.FabricObject;
            const id = (obj as any).__id as string | undefined;
            if (id && !existingIds.has(id)) cv.add(obj);
          }
          cv.requestRenderAll();
        } finally {
          setApplyingRemote(false);
        }
      }

      if (!active) return;
      merge(snapLc);

      // Apply deltas that arrived during snapshot load in Lamport order,
      // discarding those already covered by the snapshot. §4.5
      const pending = pendingDeltasRef.current
        .filter((m) => (m as any).lc > snapLc)
        .sort((a, b) => ((a as any).lc ?? 0) - ((b as any).lc ?? 0));
      pendingDeltasRef.current = [];
      for (const delta of pending) handlePeerMessage((delta as any).peerId, JSON.stringify(delta));

      snapshotReceivedRef.current = true;

      // Build connected peers map from peerInfoRef (populated by p2p:join
      // messages which arrive before snapshot:done on the ordered reliable channel).
      const peersMap = new Map<string, PeerInfo>();
      for (const [id, info] of peerInfoRef.current) peersMap.set(id, { ...info });
      setRoomState({ status: 'connected', roomId: roomIdRef.current ?? '', peerId: peerIdRef.current, peers: peersMap });
    }

    function requestSnapshotFrom(targetAppPeerId: string, isRetry = false): void {
      eldestPeerIdRef.current = targetAppPeerId;
      if (isRetry) { snapshotChunksRef.current = []; snapshotTotalRef.current = 0; }
      setRoomState({ status: 'awaiting-snapshot' });

      const trysteroId = appToTrysteroRef.current.get(targetAppPeerId);
      const sendFn = reliableSendRef.current;
      if (!trysteroId || !sendFn) {
        // Mapping not yet established (race between onPeerJoin and p2p:join).
        // The p2p:join handler will call requestSnapshotFrom again once the
        // mapping is populated.
        return;
      }

      sendFn(
        JSON.stringify({ type: 'snapshot:request', peerId: peerIdRef.current }),
        { target: trysteroId },
      ).catch((err) => console.error('[p2p] snapshot:request send error:', err));

      // 10 s timeout: if snapshot:done never arrives, fall back to next-oldest. §6.4
      if (snapshotTimeoutRef.current !== null) clearTimeout(snapshotTimeoutRef.current);
      snapshotTimeoutRef.current = setTimeout(() => {
        snapshotTimeoutRef.current = null;
        if (!active) return;
        handlePeerLeft(targetAppPeerId);
        recomputeEldest();
        const nextEldest = eldestPeerIdRef.current;
        if (nextEldest) {
          requestSnapshotFrom(nextEldest, true);
        } else {
          snapshotReceivedRef.current = true;
          const peersMap = new Map<string, PeerInfo>(peerInfoRef.current);
          setRoomState({ status: 'connected', roomId: roomIdRef.current ?? '', peerId: peerIdRef.current, peers: peersMap });
        }
      }, 10_000);
    }

    function handlePeerMessage(fromAppPeerId: string, data: string): void {
      let msg: P2PWireMessage;
      try { msg = JSON.parse(data) as P2PWireMessage; } catch { return; }

      if ('lc' in msg) merge((msg as any).lc);

      // Buffer delta messages until the snapshot is applied. §4.5
      if (!snapshotReceivedRef.current) {
        if (msg.type === 'delta:added' || msg.type === 'delta:modified' || msg.type === 'delta:removed') {
          pendingDeltasRef.current.push(msg);
          return;
        }
      }

      // ---- Snapshot protocol (handled internally, not forwarded to onMessage) ----

      if (msg.type === 'snapshot:chunk') {
        if (!snapshotChunksRef.current[msg.index]) {
          snapshotChunksRef.current[msg.index] = msg.canvas;
          snapshotTotalRef.current = msg.total;
        }
        return;
      }

      if (msg.type === 'snapshot:done') { void finishSnapshot(msg.lc); return; }
      if (msg.type === 'snapshot:request') { serveSnapshot(fromAppPeerId); return; }

      // ---- Peer lifecycle ----

      if (msg.type === 'p2p:join') {
        const remoteJoinedAt = msg.joinedAt;
        joinedAtRef.current.set(fromAppPeerId, remoteJoinedAt);
        peerInfoRef.current.set(fromAppPeerId, { id: fromAppPeerId, operatorId: msg.operatorId, cursor: null });

        // Eldest-peer determination without signaling server. §6.4
        // Tie-break by lexicographic peerId when timestamps collide.
        //
        // NOTE: the theyAreOlder branch intentionally runs even when
        // snapshotReceivedRef is already true. Nostr signaling can take
        // 10-30 s, which is longer than the 12 s first-peer timer. If the
        // timer fires first it optimistically marks snapshotReceived=true and
        // transitions to connected. When the peer's p2p:join arrives late we
        // must still request the snapshot — so the guard here is on
        // snapshotRequestedRef (never sent one yet), not snapshotReceivedRef.
        const theyAreOlder = remoteJoinedAt < myJoinedAtRef.current ||
          (remoteJoinedAt === myJoinedAtRef.current && fromAppPeerId < peerIdRef.current);

        if (theyAreOlder) {
          // This peer was in the room before us — we are the joiner.
          if (!hasOlderPeerRef.current) {
            hasOlderPeerRef.current = true;
            if (firstPeerTimerRef.current !== null) { clearTimeout(firstPeerTimerRef.current); firstPeerTimerRef.current = null; }
          }
          recomputeEldest();
          if (!snapshotRequestedRef.current && eldestPeerIdRef.current) {
            snapshotRequestedRef.current = true;
            // Re-open snapshot flow in case the first-peer timer already closed
            // it (snapshotReceived=true, status=connected with empty canvas).
            snapshotReceivedRef.current = false;
            pendingDeltasRef.current = [];
            requestSnapshotFrom(eldestPeerIdRef.current);
          }
        } else if (!snapshotReceivedRef.current && !hasOlderPeerRef.current) {
          // This peer is newer than us, and no older peer has appeared → we
          // are the eldest. Transition to connected; the joiner will request
          // a snapshot from us once they see our joinedAt.
          snapshotReceivedRef.current = true;
          if (firstPeerTimerRef.current !== null) { clearTimeout(firstPeerTimerRef.current); firstPeerTimerRef.current = null; }
          const peersMap = new Map<string, PeerInfo>();
          for (const [id, info] of peerInfoRef.current) peersMap.set(id, { ...info });
          setRoomState({ status: 'connected', roomId: roomIdRef.current ?? '', peerId: peerIdRef.current, peers: peersMap });
          dispatch({ type: 'peer:joined', peerId: fromAppPeerId, operatorId: msg.operatorId, ts: msg.lc } as unknown as InboundMessage);
          return;
        }

        setRoomState((prev) => {
          if (prev.status !== 'connected') return prev;
          const newPeers = new Map(prev.peers);
          newPeers.set(fromAppPeerId, { id: fromAppPeerId, operatorId: msg.operatorId, cursor: null });
          return { ...prev, peers: newPeers };
        });
        dispatch({ type: 'peer:joined', peerId: fromAppPeerId, operatorId: msg.operatorId, ts: msg.lc } as unknown as InboundMessage);
        return;
      }

      if (msg.type === 'p2p:leave') { handlePeerLeft(fromAppPeerId); return; }

      // ---- Canvas deltas (forwarded to onMessage handlers → useRemoteCanvas) ----
      // Map lc → ts for relay-protocol compatibility. §6 transition note.

      const ts = (msg as any).lc ?? Date.now();
      if (msg.type === 'delta:added') { dispatch({ ...msg, ts } as unknown as InboundMessage); return; }
      if (msg.type === 'delta:modified') { dispatch({ ...msg, ts } as unknown as InboundMessage); return; }
      if (msg.type === 'delta:removed') { dispatch({ ...msg, ts } as unknown as InboundMessage); return; }

      // ---- Chip ownership ----

      if (msg.type === 'chip:claim') {
        const prev = peerInfoRef.current.get(fromAppPeerId) ?? { id: fromAppPeerId, cursor: null };
        peerInfoRef.current.set(fromAppPeerId, { ...prev, operatorId: msg.operatorId });
        setRoomState((s) => {
          if (s.status !== 'connected') return s;
          const newPeers = new Map(s.peers);
          const pi = newPeers.get(fromAppPeerId);
          if (pi) newPeers.set(fromAppPeerId, { ...pi, operatorId: msg.operatorId });
          return { ...s, peers: newPeers };
        });
        dispatch({ type: 'chip:claim', peerId: fromAppPeerId, operatorId: msg.operatorId } as unknown as InboundMessage);
        return;
      }

      if (msg.type === 'chip:release') {
        const prev = peerInfoRef.current.get(fromAppPeerId) ?? { id: fromAppPeerId, cursor: null };
        peerInfoRef.current.set(fromAppPeerId, { ...prev, operatorId: null });
        setRoomState((s) => {
          if (s.status !== 'connected') return s;
          const newPeers = new Map(s.peers);
          const pi = newPeers.get(fromAppPeerId);
          if (pi) newPeers.set(fromAppPeerId, { ...pi, operatorId: null });
          return { ...s, peers: newPeers };
        });
        dispatch({ type: 'chip:release', peerId: fromAppPeerId, operatorId: msg.operatorId } as unknown as InboundMessage);
        return;
      }

      // ---- Ephemeral messages (cursor, path:stroke, path:commit) ----

      if (msg.type === 'cursor') {
        const prev = peerInfoRef.current.get(fromAppPeerId) ?? { id: fromAppPeerId, operatorId: null };
        const cursor = { x: msg.x, y: msg.y };
        peerInfoRef.current.set(fromAppPeerId, { ...prev, cursor });
        // New cursor object reference triggers GhostCursorLayer's idle timer. §9.2
        setRoomState((s) => {
          if (s.status !== 'connected') return s;
          const newPeers = new Map(s.peers);
          const pi = newPeers.get(fromAppPeerId);
          if (pi) newPeers.set(fromAppPeerId, { ...pi, cursor });
          return { ...s, peers: newPeers };
        });
        dispatch({ type: 'cursor', peerId: fromAppPeerId, x: msg.x, y: msg.y } as unknown as InboundMessage);
        return;
      }

      // path:stroke and path:commit pass through as-is.
      dispatch(msg as unknown as InboundMessage);
    }

    // ---- Trystero room setup -----------------------------------------------

    // In React 18 StrictMode (development only), effects fire twice:
    // mount → immediate cleanup → remount. When roomId comes from the URL
    // (initial useState value from window.location.search), the effect runs on
    // the very first mount and StrictMode immediately unmounts it — calling
    // room.leave() and resetting Trystero's module-level offerPool/WebSocket
    // state — before the remount calls joinRoom again.
    //
    // Trystero's strategy.mjs caches rooms in occupiedRooms[appId][roomId]
    // and unconditionally resets global state (offerPool destroyed, WebSocket
    // connections closed) when the last room leaves. The rapid leave→rejoin
    // cycle can prevent the second session's Nostr subscriptions from
    // connecting, making both peers appear to be in separate rooms even though
    // they share the same roomId.
    //
    // UUID typing does NOT hit this: when roomId is null on mount, the effect
    // returns early without calling joinRoom, so StrictMode double-invoke is
    // harmless. joinRoom is only called once, on the state-change re-run after
    // the user types, by which point StrictMode effects are long settled.
    //
    // Fix: defer joinRoom to the next macrotask (setTimeout 0). StrictMode
    // cleanup sets active=false and cancels the timer before it fires, so
    // joinRoom is called exactly once per real mount regardless of StrictMode.
    let roomObj: any = null;
    let unloadHandler: (() => void) | null = null;

    const startupTimer = setTimeout(() => {
      if (!active) return; // StrictMode ran cleanup before the timer fired

      // relayConfig.urls pins the 5 Nostr relays that are known to accept events
      // without NIP-42 auth. Trystero's default shuffle for appId 'tarkov-debrief'
      // lands on 5 hobby relays that all require NIP-42 auth, which Trystero
      // ignores — signaling silently fails. These relays were verified working via
      // the scratch-trystero-test.html file (appId 'tarkov-debrief-scratch' maps to
      // the same set via its shuffle seed).
      // rtcConfig passes our full ICE server list (STUN + TURN).
      const room = joinRoom({
        appId: 'tarkov-debrief',
        relayConfig: {
          // These are the relays Trystero's shuffle selects for appId
          // 'tarkov-debrief-scratch', verified working in scratch-trystero-test.html.
          // The natural shuffle for appId 'tarkov-debrief' lands on 5 relays that
          // all require NIP-42 auth (Trystero ignores it → silent failure).
          urls: [
            'wss://testnet-relay.samt.st',
            'wss://nostr.tegila.com.br',
            'wss://nostr-01.yakihonne.com',
            'wss://relay.notoshi.win',
            'wss://relay.mostro.network',
          ],
        },
        rtcConfig: { iceServers: ICE_SERVERS },
      }, roomId);
      roomObj = room;

      // Reliable action: carries all canvas deltas, snapshot, and lifecycle frames.
      // Mirrors the 'reliable' ordered DataChannel from §4.1.
      const reliableAction = (room as any).makeAction('reliable') as TrysteroAction;
      // Set onMessage synchronously — any messages buffered by Trystero during
      // the null window flush immediately via flushMessages(). §actions.mjs §99
      reliableAction.onMessage = (data, { peerId: trysteroId }) => {
        if (!active) return;
        let appPeerId: string;
        try { appPeerId = (JSON.parse(data) as any).peerId; } catch { return; }
        if (!appPeerId) return;
        // Populate ID mapping on first message from each Trystero peer.
        trysteroToAppRef.current.set(trysteroId, appPeerId);
        appToTrysteroRef.current.set(appPeerId, trysteroId);
        handlePeerMessage(appPeerId, data);
      };
      reliableSendRef.current = reliableAction.send.bind(reliableAction);

      // Ephemeral action: carries cursor, path:stroke, path:commit.
      // Semantically fire-and-forget; no Lamport clock on these frames. §4.1
      const ephemeralAction = (room as any).makeAction('ephemeral') as TrysteroAction;
      ephemeralAction.onMessage = (data, { peerId: trysteroId }) => {
        if (!active) return;
        let appPeerId: string;
        try { appPeerId = (JSON.parse(data) as any).peerId; } catch { return; }
        if (!appPeerId) return;
        // Ephemeral messages may arrive before the reliable p2p:join — update
        // mapping here too so we don't drop cursor updates from unknown peers.
        if (!trysteroToAppRef.current.has(trysteroId)) {
          trysteroToAppRef.current.set(trysteroId, appPeerId);
          appToTrysteroRef.current.set(appPeerId, trysteroId);
        }
        handlePeerMessage(appPeerId, data);
      };
      ephemeralSendRef.current = ephemeralAction.send.bind(ephemeralAction);

      // onPeerJoin fires when Trystero's handshake completes (WebRTC DataChannels
      // ready). Send p2p:join immediately so the remote peer can determine who
      // is the snapshot authority based on our joinedAt timestamp. §6.4
      (room as any).onPeerJoin = (trysteroId: string) => {
        if (!active) return;
        reliableSendRef.current?.(
          JSON.stringify({
            type: 'p2p:join',
            peerId: peerIdRef.current,
            operatorId: operatorIdRef.current,
            joinedAt: myJoinedAtRef.current,
            lc: tick(),
          }),
          { target: trysteroId },
        ).catch((err) => console.error('[p2p] p2p:join send error:', err));
      };

      // onPeerLeave fires on Trystero-detected disconnect (DataChannel close or
      // ICE failure). Also triggered after clean p2p:leave for belt-and-suspenders.
      (room as any).onPeerLeave = (trysteroId: string) => {
        if (!active) return;
        const appPeerId = trysteroToAppRef.current.get(trysteroId);
        trysteroToAppRef.current.delete(trysteroId);
        if (appPeerId) {
          appToTrysteroRef.current.delete(appPeerId);
          handlePeerLeft(appPeerId);
        }
      };

      // First-peer detection: if no onPeerJoin fires within 12 s, we are the only
      // peer in the room → skip snapshot, go connected with empty canvas.
      // 12 s because Nostr relay signaling can take 10-30 s (relay round-trips +
      // WebRTC ICE); a shorter timer fires before the peer is found and would leave
      // the joiner on an empty canvas until the p2p:join logic corrects it. §3.4
      firstPeerTimerRef.current = setTimeout(() => {
        firstPeerTimerRef.current = null;
        if (!active || stateRef.current.status !== 'connecting') return;
        snapshotReceivedRef.current = true;
        setRoomState({ status: 'connected', roomId, peerId, peers: new Map() });
      }, 12_000);

      // Announce leave on tab close. useEffect cleanup does not run on unload.
      unloadHandler = () => {
        reliableSendRef.current?.(
          JSON.stringify({ type: 'p2p:leave', peerId, lc: tick() }),
        ).catch(() => {});
        (room as any).leave();
      };
      window.addEventListener('beforeunload', unloadHandler);
    }, 0);

    return () => {
      active = false;
      // Cancels the deferred startup if StrictMode unmounts before the timer
      // fires. If the timer already ran, this is a no-op.
      clearTimeout(startupTimer);

      if (unloadHandler) {
        window.removeEventListener('beforeunload', unloadHandler);
        unloadHandler = null;
      }

      if (firstPeerTimerRef.current !== null) { clearTimeout(firstPeerTimerRef.current); firstPeerTimerRef.current = null; }
      if (snapshotTimeoutRef.current !== null) { clearTimeout(snapshotTimeoutRef.current); snapshotTimeoutRef.current = null; }

      if (roomObj) {
        reliableSendRef.current?.(
          JSON.stringify({ type: 'p2p:leave', peerId, lc: tick() }),
        ).catch(() => {});

        // Null out send refs before leave() so any in-flight async callbacks
        // that check active=false also skip network sends.
        reliableSendRef.current = null;
        ephemeralSendRef.current = null;

        (roomObj as any).leave();
        roomObj = null;
      }

      peerInfoRef.current.clear();
      trysteroToAppRef.current.clear();
      appToTrysteroRef.current.clear();

      setRoomState({ status: 'disconnected' });
    };
    // operatorId is ref-mirrored — chip changes after join use chip:claim/release.
  }, [roomId, peerId]);

  return { state: roomState, stateRef, broadcast, onMessage };
}
