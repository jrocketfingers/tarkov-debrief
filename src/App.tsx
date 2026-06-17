import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as fabric from "fabric";
import { TwitterPicker } from "react-color";
import { Link, useParams } from "wouter";
import "@/App.css";
import "@/Sidebar.css";

import { maps } from "@/MapSelector";

import githubLogo from "./icons/github.png";
import selectIcon from "./icons/select.svg";
import pencilIcon from "./icons/pencil.svg";
import eraserIcon from "./icons/eraser.svg";
import addMarkerIcon from "./icons/marker.svg";
import saveIcon from "./icons/save.svg";
import undoIcon from "./icons/undo.svg";

import thickPMCMarker from "./icons/pmc-thick.svg";
import mediumPMCMarker from "./icons/pmc-med.svg";
import lightPMCMarker from "./icons/pmc-light.svg";
import scavMarker from "./icons/scav.svg";
import { Tool, ToolType } from "./tools/tool";
import { useSelect } from "./tools/select";
import { usePencil } from "./tools/pencil";
import { useArrow } from "./tools/arrow";
import { useMark } from "./tools/marks/useMark";
import { registerControls } from "./tools/marks/controls";
import { registerMark } from "./tools/marks/registry";
import { SIGHTLINE_SPEC } from "./tools/marks/sightline";
import { CONE_SPEC } from "./tools/marks/cone";
import { ENGAGEMENT_X_SPEC } from "./tools/marks/engagementX";
import { SOUND_PING_SPEC } from "./tools/marks/soundPing";
import { POSITION_DOT_SPEC } from "./tools/marks/positionDot";
import { TEXT_SPEC } from "./tools/marks/text";
import { useEraser } from "./tools/eraser";
import { useStamp } from "./tools/stamp";
import { useZoom } from "./tools/zoom";
import { usePan } from "./tools/pan";
import { useUndo } from "./tools/undo";
import {
  useKeyboardShortcuts,
  type Binding,
  type SuspensionRef,
} from "./hooks/useKeyboardShortcuts";
import { createEraserSession } from "./tools/eraserCore";
import { dashArrayForZoom } from "./tools/dashCompensation";
import { OutlinedPencilBrush } from "./tools/OutlinedBrush";
import {
  getActiveOperator,
  loadActiveOperatorId,
  loadOperators,
  saveActiveOperatorId,
  saveOperators,
  type Operator,
  type OperatorId,
} from "./state/operators";
import { loadPhase, savePhase, type Phase } from "./state/phase";
import { loadTool, saveTool, isTransientTool } from "./state/tool";
import { useTimeline } from "./state/timeline";
import { applyAnimation, resetAnimation } from "./tools/marks/animators";
import {
  readId,
  readMarkType,
  readOperator,
  readArrowTip,
} from "./tools/metadata";
import { Scrubber } from "./components/Scrubber";
import { OperatorChips } from "./components/OperatorChips";
import { PhaseToggle } from "./components/PhaseToggle";
import {
  MarkerRadial,
  type MarkerOption,
} from "./components/MarkerRadial";
import { HotkeysOverlay } from "./components/HotkeysOverlay";
import { RoomBar } from "./components/RoomBar";
import { getOrCreatePeerId, usePeerRoom } from "./collab/usePeerRoom";
import { useRemoteCanvas, isApplyingRemote, EXTRAS } from "./collab/useRemoteCanvas";
import { GhostCursorLayer } from "./collab/GhostCursorLayer";
import { usePartialPath } from "./collab/usePartialPath";
import { isFlagged, REPLAY, TRANSIENT } from "./tools/undo";

const githubUrl = "https://github.com/jrocketfingers/tarkov-debrief";

type Size = { width: number; height: number };

const defaultSize: Size = { width: 300, height: 300 };

function startDownload(url: string, name: string): void {
  const link = document.createElement("a");
  link.download = name;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const brushWidth = 5;
const PENCIL_COLOR: string = "#f00";

function initializeCanvas() {
  const canvas = new fabric.Canvas("canvas", {
    height: defaultSize.height,
    width: defaultSize.width,
    // Start false — useFreehand sets it true when pencil/arrow is active.
    // Starting true here would leave the canvas in drawing mode for any
    // non-drawing tool persisted in localStorage (e.g. marker), letting the
    // brush capture strokes without a before:path:created handler registered,
    // so those strokes would never get an __id and could not be broadcast.
    isDrawingMode: false,
    perPixelTargetFind: true,
    selection: false,
    fireMiddleClick: true,
    fireRightClick: true,
  });

  // OutlinedPencilBrush is a thin two-pass subclass of PencilBrush
  // — see src/tools/OutlinedBrush.ts. It renders a wider solid
  // outline pass underneath each main stroke (both live and
  // finalized), and emits OutlinedPath instances so the finalized
  // strokes keep the same outline behavior. needsFullRender is
  // forced true inside the subclass, which also subsumes the
  // dash-pattern continuity requirement (without full re-render,
  // dashes would discontinue between segments) — so we don't need
  // a separate needsFullRender override here.
  const brush = new OutlinedPencilBrush(canvas);
  brush.color = PENCIL_COLOR;
  brush.width = brushWidth;
  // Override fabric's default decimate (0.4 zoom-adjusted screen px),
  // which is so tight it captures every mouse-jitter point and
  // produces visibly wavy "straight" lines — especially obvious when
  // the path is later viewed at higher zoom than it was drawn at.
  // fabric internally divides this by canvas zoom, so the value is
  // an effective screen-pixel threshold: points closer than ~4 px
  // (post zoom-compensation) are dropped before the path is
  // finalized. See fabric@7.3.1/src/brushes/PencilBrush.ts line
  // 250–251 (decimatePoints) for the math.
  brush.decimate = 4;

  canvas.freeDrawingBrush = brush;

  canvas.setCursor(`url(${pencilIcon})`);

  return canvas;
}

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <div className="sidebar-section">
      <h1 className="sidebar-section-title">{title}</h1>
      <div className="sidebar-section-content">{children}</div>
    </div>
  );
}

interface Params {
  map: string;
}

function App() {
  const { map } = useParams<Params>();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  // Lazy initializer reads the persisted active tool from
  // localStorage. One-shot tools (sightline, cone, text) soft-fail
  // to the default — design doc §9.3 §15.1 R-E. The `active` and
  // `cursor` fields are derived state and re-established by each
  // tool hook on activation; we only persist the ToolType itself.
  const [tool, setTool] = useState<Tool>(() => ({
    type: loadTool(),
    active: false,
    cursor: null,
  }));

  const [color, setColor] = useState<string>(PENCIL_COLOR);
  const [maybeCanvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(false);
  // Stable Set of object src URLs the eraser/undo must skip (e.g. the
  // background map image). Owned by App so it survives re-renders, and
  // gets reset on every map switch (PR 4 leak fix).
  const unerasableRef = useRef<Set<string>>(new Set());
  const unerasable = unerasableRef.current;
  // Chain anchor for sightline + cone (and any future "off the last
  // arrow tip" mark). NOT directly set by the arrow tool — instead,
  // each arrow group carries its own `__arrowTip` metadata
  // (see tools/metadata.ts + tools/arrow.ts) and a canvas-level
  // subscriber below walks objects in reverse on every add/remove
  // to find the most-recent arrow's tip. This lets undo, eraser,
  // and any future redo update the anchor automatically — without
  // each mutation path having to know about the chain anchor.
  // Reset on map switch alongside `unerasable` so map-A coordinates
  // don't leak into map-B's chain.
  const lastArrowTipRef = useRef<{ x: number; y: number } | null>(null);
  // Shortcut suspension ref, shared with MarkerRadial,
  // HotkeysOverlay, and useMark's text-interaction effect. The
  // text effect flips it true while waiting for the user's first
  // click — without that, unmodified letter keystrokes would
  // match other tool bindings (e.g. `a` → arrow) and tear text
  // mode down. Declared this high because useMark(TEXT_SPEC, …)
  // runs below and needs it in scope.
  const shortcutsSuspended = useRef<boolean>(false) as SuspensionRef;

  // === Operator + phase state (Phase 4 of design_p0_slice.md) ===
  //
  // The roster and active id are mirrored to localStorage on every
  // change. Initial value comes from localStorage on mount (lazy
  // initializer = runs once). Defaults live in src/state/operators.ts.
  //
  // Why operator state lives here and not deeper: pencil + future
  // tools all need to read the active operator's color and id; the
  // chip strip + radial / sidebar all mutate it. App.tsx is the
  // canonical owner per design doc §5.2.
  const [operators, setOperators] = useState<Operator[]>(() =>
    loadOperators(),
  );
  const [activeOperatorId, setActiveOperatorId] = useState<OperatorId | null>(
    () => loadActiveOperatorId(),
  );
  const [phase, setPhase] = useState<Phase>(() => loadPhase());

  // === P3 multiplayer room state ===
  //
  // peerId is stable per browser tab (sessionStorage). roomId is null when the
  // user is not in a room, or a UUID v4 when connected. See design doc §6.1.
  const [peerId] = useState<string>(getOrCreatePeerId);

  // Auto-join: read the room ID from the URL query string on first render so
  // that pasting a copied link auto-connects without requiring a manual paste
  // into the RoomBar input. §11.2
  const [roomId, setRoomId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('room');
    const UUID_V4_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return rid && UUID_V4_RE.test(rid) ? rid : null;
  });

  // useMemo so activeOperator is stable for hooks that depend on it.
  // Declared here (before useRoom) so operatorId can be passed on join.
  const activeOperator = useMemo(
    () => getActiveOperator(operators, activeOperatorId),
    [operators, activeOperatorId],
  );
  // usePeerRoom replaces useRoom for the P2P variant. Canvas is needed so the
  // eldest peer can serialize it for snapshot requests. §6.2
  const roomRoom = usePeerRoom(roomId, peerId, activeOperator?.id ?? null, maybeCanvas);
  const roomStatus = roomRoom.state.status;
  // Flatten Map → PeerInfo[] for GhostCursorLayer and peerCount display.
  const peers = roomRoom.state.status === 'connected'
    ? Array.from(roomRoom.state.peers.values())
    : [];
  const roomOnMessage = roomRoom.onMessage;
  const roomBroadcast = roomRoom.broadcast;
  // stateRef for chip-claim: read peers at effect-fire time without subscribing
  // to a snapshot InboundMessage (P2P has no relay-style snapshot message). §10.1
  const roomStateRef = roomRoom.stateRef;

  const handleRoomChange = useCallback((id: string | null) => {
    setRoomId(id);
  }, []);

  // P3.5: join-flow toast — "You're drawing as Alpha — tap a chip to change."
  // Auto-dismisses after 3 s. §11.2
  const [joinToastName, setJoinToastName] = useState<string | null>(null);
  const joinToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!joinToastName) return;
    if (joinToastTimerRef.current) clearTimeout(joinToastTimerRef.current);
    joinToastTimerRef.current = setTimeout(() => setJoinToastName(null), 3000);
    return () => {
      if (joinToastTimerRef.current) clearTimeout(joinToastTimerRef.current);
    };
  }, [joinToastName]);

  // Ref-mirrors for claim-on-join effect so it reads current state without
  // re-running when those values change (only roomStatus is the trigger). §10.1
  const operatorsRefP35 = useRef(operators);
  operatorsRefP35.current = operators;
  const activeOperatorIdRef = useRef(activeOperatorId);
  activeOperatorIdRef.current = activeOperatorId;

  // P3.5: claim-on-join — when the room transitions to connected, re-claim an
  // existing chip immediately, or auto-assign the first unclaimed one. §10.1
  //
  // P2P: unlike the relay variant, 'connected' fires AFTER the snapshot has been
  // applied and peerInfo is fully populated. We read claimed chips directly from
  // roomStateRef (instead of subscribing to a snapshot InboundMessage which P2P
  // doesn't emit). React has committed the connected state before effects run, so
  // roomStateRef.current reflects the current peers at effect-fire time. §10.1
  //
  // Race fix: when two peers join simultaneously, both see each other in peers
  // but neither has received the other's chip:claim yet, so claimedIds is empty
  // for both. Deterministic rank-based assignment prevents collision: sort all
  // peer IDs (self + remote), each peer picks the operator at its own rank index.
  // Both peers compute the same sorted order, so they independently choose
  // different operators without needing to see each other's claim first.
  useEffect(() => {
    if (roomStatus !== 'connected') return;

    const currentId = activeOperatorIdRef.current;
    if (currentId) {
      // Already have a chip (from localStorage or previous session) — re-claim
      // it so other peers see the badge. chip-change effect won't fire because
      // activeOperatorId didn't change.
      roomBroadcast({ type: 'chip:claim', operatorId: currentId });
      setJoinToastName(
        operatorsRefP35.current.find((op) => op.id === currentId)?.name ?? null,
      );
      return;
    }

    // No saved chip — read which chips are claimed from the current room state.
    // roomStateRef is stable and its .current reflects the just-committed state.
    const st = roomStateRef.current;
    // stateRef.current is RefObject<T>.current which TypeScript types as T|null,
    // though in practice it's always initialized before this effect runs.
    if (!st || st.status !== 'connected') return;
    const claimedIds = new Set(
      Array.from(st.peers.values()).map((p) => p.operatorId).filter(Boolean),
    );
    const unclaimedOps = operatorsRefP35.current.filter((op) => !claimedIds.has(op.id));
    if (unclaimedOps.length === 0) return;

    // Rank-based selection: include self in the sorted peer list so every peer
    // sees the same total set and picks a unique slot by index. Peers that
    // already claimed a chip are not in this branch (early-return above), so
    // only "fresh" peers compete here. If there are more unclaimed peers than
    // unclaimed operators, the last peers fall back to the first operator
    // (harmless: they can always manually switch chips afterward).
    const allPeerIds = [peerId, ...Array.from(st.peers.keys())].sort();
    const myRank = allPeerIds.indexOf(peerId);
    const toAssign = unclaimedOps[myRank] ?? unclaimedOps[0];
    setActiveOperatorId(toAssign.id);
    setJoinToastName(toAssign.name);
    // chip:claim is broadcast by the chip-change effect after the state
    // update triggers a re-render (activeOperatorId null → toAssign.id).
  // roomStateRef and peerId are stable refs/values — identity never changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomStatus, roomBroadcast]);

  // P3.5: broadcast chip:release + chip:claim whenever the user changes their
  // active operator while connected. Prev-value tracking via ref ensures we
  // always know what to release. §10.1
  const prevActiveOperatorIdRef = useRef<OperatorId | null>(null);
  useEffect(() => {
    const prev = prevActiveOperatorIdRef.current;
    prevActiveOperatorIdRef.current = activeOperatorId;

    if (roomStatus !== 'connected') return;
    if (prev === activeOperatorId) return; // no change
    if (prev !== null) roomBroadcast({ type: 'chip:release', operatorId: prev });
    if (activeOperatorId !== null) roomBroadcast({ type: 'chip:claim', operatorId: activeOperatorId });
  }, [activeOperatorId, roomStatus, roomBroadcast]);

  // P3.5: conflict resolution — if a remote peer claims the same operator I
  // hold, the peer with the LOWER peerId wins; I yield to the next unclaimed
  // operator. Watches TWO message types for two distinct race shapes:
  //
  //   chip:claim — remote peer sends a fresh claim after both are connected.
  //     Covers the localStorage-same-chip case where both re-claim the same
  //     stored op on join.
  //
  //   peer:joined — remote peer's operatorId arrives via p2p:join handshake
  //     when two peers first meet. This is the dominant path when BOTH hit the
  //     12-second first-peer timer independently (each goes 'connected' with an
  //     empty room, both claim Alpha, then meet). Their chip:claim broadcasts
  //     had zero recipients at claim-time, so no chip:claim ever arrives — only
  //     peer:joined carries the operatorId at meeting time.
  //
  // Lower peerId wins so both sides independently agree on who yields without
  // needing an extra round-trip. §10.1
  useEffect(() => {
    const unsub = roomOnMessage((msg) => {
      let conflictOp: string | null = null;
      let fromPeer: string | null = null;

      if (msg.type === 'chip:claim') {
        conflictOp = msg.operatorId;
        fromPeer = msg.peerId;
      } else if (msg.type === 'peer:joined' && msg.operatorId) {
        // p2p:join includes operatorId; dispatched as peer:joined by usePeerRoom.
        conflictOp = msg.operatorId;
        fromPeer = msg.peerId;
      }

      if (!conflictOp || !fromPeer) return;
      const mine = activeOperatorIdRef.current;
      // Only act when the incoming op conflicts with ours.
      if (!mine || conflictOp !== mine) return;
      // Lower peerId wins — if remote is higher than us, we keep our claim.
      if (fromPeer >= peerId) return;
      // We lose. Pick the next operator not yet taken by any peer (including
      // the winner who just took `mine`).
      const st = roomStateRef.current;
      const takenIds = new Set([
        mine,
        ...(st?.status === 'connected'
          ? Array.from(st.peers.values()).map((p) => p.operatorId).filter(Boolean)
          : []),
      ]);
      const next = operatorsRefP35.current.find((op) => !takenIds.has(op.id));
      setActiveOperatorId(next?.id ?? null);
    });
    return unsub;
    // roomOnMessage is stable (useCallback []). activeOperatorIdRef, peerId,
    // roomStateRef, operatorsRefP35 are stable refs/values. §10.1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomOnMessage]);

  // Keep the URL query string in sync with roomId so the address bar always
  // holds a copyable link, and so a page reload re-joins the same room. §11.2
  useEffect(() => {
    const url = new URL(window.location.href);
    if (roomId) {
      url.searchParams.set('room', roomId);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState(null, '', url.toString());
  }, [roomId]);

  // Persist on every change. localStorage writes are synchronous in
  // jsdom and fast in browsers; no debounce needed for the change
  // volumes this UI produces.
  useEffect(() => {
    saveOperators(operators);
  }, [operators]);
  useEffect(() => {
    saveActiveOperatorId(activeOperatorId);
  }, [activeOperatorId]);
  useEffect(() => {
    savePhase(phase);
  }, [phase]);
  // Persist the active tool, skipping transient one-shots so a
  // mid-gesture reload doesn't leave the user in a tool whose
  // anchor (lastArrowTipRef) is gone. Design doc §9.3.
  //
  // Spring-loaded quasi-modes (Space-hold pan, RMB-hold eraser)
  // ALSO write through here because their final `setTool` call
  // restores the previous tool — so the persisted value is always
  // the user's intended "resting" tool, not the transient flip.
  // No churn-suppression needed beyond the transient-skip.
  useEffect(() => {
    if (isTransientTool(tool.type)) return;
    saveTool(tool.type);
  }, [tool.type]);

  const save = () => {
    if (maybeCanvas) {
      const url = maybeCanvas.toDataURL({ multiplier: 3 });
      startDownload(url, "strategy.png");
    }
  };

  // useUndo first so its full API (markTransient, popLastAction,
  // recordAdd, …) is available to tool hooks that need it — most
  // notably useArrow's path→group swap (design doc §5.1 step 8).
  const undoApi = useUndo(maybeCanvas, unerasable);
  const { onUndo } = undoApi;

  // P3.2: apply remote canvas deltas from peers without touching the
  // local undo stack. roomOnMessage is stable (useCallback, empty deps).
  // See design_p3_multiplayer.md §7.
  useRemoteCanvas(maybeCanvas, { onMessage: roomOnMessage }, unerasable);

  // P3.4: broadcast in-progress freehand strokes as partial-path frames so
  // remote peers see a live ghost while the user draws. See §8.
  usePartialPath(
    maybeCanvas,
    roomOnMessage,
    roomBroadcast,
    roomStatus,
    operators,
    activeOperatorId,
    phase,
  );

  // P3.3: track the canvas viewport transform in React state so
  // GhostCursorLayer re-renders correctly after pan/zoom. Must be the full
  // 6-element affine matrix — a scalar zoom is insufficient once the user
  // has panned (R8). fabric v7 has no dedicated viewport:transformed event,
  // so we read canvas.viewportTransform on after:render (fires after every
  // pan/zoom/draw) and only schedule a React update when the matrix changed.
  const [viewportTransform, setViewportTransform] = useState<number[]>([1, 0, 0, 1, 0, 0]);
  useEffect(() => {
    if (!maybeCanvas) return;
    const canvas = maybeCanvas;
    const onRender = () => {
      const vpt = canvas.viewportTransform;
      setViewportTransform((prev) => {
        // Only re-render when the transform actually changed.
        if (prev.length === vpt.length && prev.every((v, i) => v === vpt[i])) return prev;
        return [...vpt];
      });
    };
    canvas.on('after:render', onRender);
    return () => canvas.off('after:render', onRender);
  }, [maybeCanvas]);

  // P3.3: broadcast local cursor position to peers at ~30 fps. Canvas coords
  // (pre-viewportTransform) so receivers can apply their own pan/zoom. §9.3
  const lastCursorSend = useRef(0);
  const lastCursorPos = useRef({ x: -Infinity, y: -Infinity });
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !maybeCanvas) return;
    const canvas = maybeCanvas;

    const onMouseMove = (e: MouseEvent) => {
      if (roomStatus !== 'connected') return;
      const now = Date.now();
      if (now - lastCursorSend.current < 33) return; // 30 fps cap
      // Convert screen coordinates to canvas (scene) coordinates by inverting
      // the current viewport transform. fabric v7 removed restorePointerVpt;
      // invertTransform + transformPoint is the v7 equivalent. §9.3
      const pt = fabric.util.transformPoint(
        new fabric.Point(e.offsetX, e.offsetY),
        fabric.util.invertTransform(canvas.viewportTransform),
      );
      // Dead-zone: skip if cursor hasn't moved enough to matter for ghost rendering.
      const x = Math.round(pt.x * 10) / 10;
      const y = Math.round(pt.y * 10) / 10;
      if (Math.abs(x - lastCursorPos.current.x) < 2 && Math.abs(y - lastCursorPos.current.y) < 2) return;
      lastCursorSend.current = now;
      lastCursorPos.current = { x, y };
      roomBroadcast({ type: 'cursor', x, y });
    };

    container.addEventListener('mousemove', onMouseMove);
    return () => container.removeEventListener('mousemove', onMouseMove);
  }, [maybeCanvas, roomStatus, roomBroadcast]);

  // P2: replay timeline. Subscribes to object:added/:removed and
  // owns the playhead + speed + play/pause state. Consumed by the
  // render-composition effect below (combined operator-visibility
  // + playhead-animation walk) and by <Scrubber /> in the JSX.
  // See claudedocs/design_p2_slice.md §5 and src/state/timeline.ts.
  const timeline = useTimeline(maybeCanvas);
  // Ref-mirror so the Shift+Space binding action reads the live
  // isPlaying state without re-creating the bindings array every
  // render (the bindings useMemo deps stay focused on tool-hook
  // setters, not on changing timeline state). Same pattern as
  // operatorRef / phaseRef in useFreehand and lastCursorRef
  // elsewhere in App.tsx.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const { onChoice: setSelect } = useSelect(maybeCanvas, setTool, tool);

  // usePencil reads operator + phase via ref-mirror — see the
  // pencil.ts comment for why. We pass them through so new strokes
  // get tagged with the currently active operator (or null) and
  // the current phase. The ref-mirror inside usePencil ensures that
  // a switch between operators / phases takes effect on the very
  // next stroke without re-mounting the effect.
  const { onChoice: setPencil, onColorChoice } = usePencil(
    maybeCanvas,
    setTool,
    tool,
    setColor,
    activeOperatorId,
    phase,
    undoApi,
  );

  // useArrow shares useFreehand with pencil but adds the arrowhead
  // postprocess (design doc §5.1). The path→group swap consumes the
  // undo API to retract the path's auto-add and mark the path
  // transient — only the resulting group lands on the undo stack.
  // lastArrowTipRef is updated every time an arrow commits, feeding
  // sightline + cone chains.
  const { onChoice: setArrow } = useArrow(
    maybeCanvas,
    setTool,
    tool,
    activeOperatorId,
    phase,
    undoApi,
  );

  // Sightline is the first chained-click MarkSpec consumer. The
  // useMark factory implements the activation soft-fail + preview
  // + commit + auto-revert lifecycle; see useMark.ts for the flow
  // and design doc §4.5 for the contract.
  const { onChoice: setSightline } = useMark(SIGHTLINE_SPEC, {
    canvas: maybeCanvas,
    tool,
    setTool,
    activeOperator,
    activeOperatorId,
    phase,
    lastArrowTipRef,
    undo: undoApi,
  });

  // Cone — the chained-drag MarkSpec consumer. Origin = last arrow
  // tip; mouse:down sets the first edge direction; the integrated
  // signed sweep during the drag determines the angular extent
  // (reflex sectors supported); release commits and auto-reverts
  // to arrow. See design doc §6.
  const { onChoice: setCone } = useMark(CONE_SPEC, {
    canvas: maybeCanvas,
    tool,
    setTool,
    activeOperator,
    activeOperatorId,
    phase,
    lastArrowTipRef,
    undo: undoApi,
  });

  // Point marks (engagement X, sound ping, position dot) and text
  // label. All sticky for the point set (place several in a row);
  // text is one-shot (single edit per invocation). Each shares the
  // useMark factory; specs differ only in build geometry, color
  // resolution, and phase treatment. Design doc §7, §8.
  const sharedMarkOpts = {
    canvas: maybeCanvas,
    tool,
    setTool,
    activeOperator,
    activeOperatorId,
    phase,
    lastArrowTipRef,
    undo: undoApi,
  };
  const { onChoice: setEngagementX } = useMark(
    ENGAGEMENT_X_SPEC,
    sharedMarkOpts,
  );
  const { onChoice: setSoundPing } = useMark(SOUND_PING_SPEC, sharedMarkOpts);
  const { onChoice: setPositionDot } = useMark(
    POSITION_DOT_SPEC,
    sharedMarkOpts,
  );
  // Text alone needs the shortcut suspension ref so unmodified
  // letter keys don't tear text mode down while the user is
  // waiting to click. See useMark.ts text effect comment.
  const { onChoice: setText } = useMark(TEXT_SPEC, {
    ...sharedMarkOpts,
    suspendedRef: shortcutsSuspended,
  });

  const { onChoice: setEraser } = useEraser(
    maybeCanvas,
    setTool,
    tool,
    unerasable
  );

  // Phase 5 uses the radial-friendly `selectMarker` entry; the
  // legacy DOM-event `onChoice` is still exported from useStamp
  // for ergonomic continuity but no longer rendered from here
  // (the sidebar marker section is gone — see JSX below).
  // Sidebar removal + react-color cleanup is tech debt (§8.4).
  const { selectMarker: setMarkerByUrl } = useStamp(
    maybeCanvas,
    setSidebar,
    tool,
    setTool,
    activeOperatorId,
    phase,
  );

  usePan(maybeCanvas, setTool, tool);

  // FIXME: untie zoom tool from brush
  useZoom(maybeCanvas, brushWidth);

  // Register all mark specs into the central registry exactly
  // once (module-level run via lazy useEffect with empty deps —
  // registerMark is idempotent per the registry header). useUndo's
  // modify-action path (§4.10) and registerControls below both
  // look specs up via getSpecByMarkType; without this registration
  // step those lookups return null and direct-manipulation +
  // modify-undo silently break.
  useEffect(() => {
    registerMark(SIGHTLINE_SPEC);
    registerMark(CONE_SPEC);
    registerMark(ENGAGEMENT_X_SPEC);
    registerMark(SOUND_PING_SPEC);
    registerMark(POSITION_DOT_SPEC);
    registerMark(TEXT_SPEC);
  }, []);

  // Direct-manipulation handles for sightlines and cones (Slice K).
  // The hook subscribes to selection:created/updated and installs
  // per-MarkType `fabric.Control` instances onto the selected
  // object via spec.buildControls. Returns a cleanup that
  // unsubscribes on canvas unmount.
  useEffect(() => registerControls(maybeCanvas), [maybeCanvas]);

  // === Chain-anchor recomputer ===
  //
  // Keep `lastArrowTipRef` in sync with canvas truth: walk objects
  // in reverse, find the most-recent arrow, read its `__arrowTip`.
  // Subscribed to both add and remove so undo and eraser update
  // the anchor automatically — drawing a sightline after undoing
  // the last arrow correctly anchors at the now-most-recent arrow
  // (or soft-fails if there isn't one).
  //
  // Walk is O(canvas-objects). At expected sizes (hundreds of marks
  // max in a single debrief) the cost is negligible per event.
  useEffect(() => {
    if (!maybeCanvas) return;
    const canvas = maybeCanvas;
    const recompute = () => {
      const objs = canvas.getObjects();
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (o === undefined) continue;
        if (readMarkType(o) !== "arrow") continue;
        const tip = readArrowTip(o);
        if (tip !== null) {
          lastArrowTipRef.current = tip;
          return;
        }
      }
      // No arrows left on the canvas — clear the anchor so the
      // next sightline / cone activation correctly soft-fails.
      lastArrowTipRef.current = null;
    };
    canvas.on("object:added", recompute);
    canvas.on("object:removed", recompute);
    // Also recompute once on mount in case the canvas already has
    // arrows (e.g., a future "restore from save" flow).
    recompute();
    return () => {
      canvas.off("object:added", recompute);
      canvas.off("object:removed", recompute);
    };
  }, [maybeCanvas]);

  // === P3.2 — Broadcast local canvas actions to the room ===
  //
  // Named handler refs (const onAdd = ...) are REQUIRED here — see
  // design_p3_multiplayer.md §7.6 (R15, Check B): canvas.off(event, fn)
  // needs the exact same function reference. Anonymous lambdas passed to
  // canvas.off without a reference would remove ALL handlers for the
  // event, including useUndo's listeners.
  useEffect(() => {
    if (!maybeCanvas || !roomId) return;
    const canvas = maybeCanvas;

    const onAdd = ({ target }: { target: fabric.FabricObject }) => {
      // Skip remote-applied objects (would echo them back to the room). §7.1
      if (isApplyingRemote()) return;
      // Skip undo-replay and transient preview objects. §7.6
      if (isFlagged(target, REPLAY) || isFlagged(target, TRANSIENT)) return;
      // Map image and other untagged objects have no __id; don't broadcast.
      const id = readId(target);
      if (!id) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serialized = (target as any).toObject(EXTRAS);
      // toObject cast: EXTRAS contains custom __-prefixed props outside
      // fabric's strict type — same pattern as tagObject in metadata.ts.
      roomBroadcast({ type: 'delta:added', obj: serialized });
    };

    const onModified = ({ target }: { target: fabric.FabricObject }) => {
      if (isApplyingRemote()) return;
      if (isFlagged(target, REPLAY) || isFlagged(target, TRANSIENT)) return;

      // Multi-selection: fabric fires object:modified on an ActiveSelection
      // (a transient group with no __id). Broadcast each child's absolute
      // transform by composing the group matrix with the child's own matrix.
      // child.calcTransformMatrix() already returns the absolute canvas
      // transform when the child has a group parent. §7.6
      if (target instanceof fabric.ActiveSelection) {
        const now = Date.now();
        for (const child of target.getObjects()) {
          const childId = readId(child as fabric.FabricObject);
          if (!childId) continue;
          if (isFlagged(child as fabric.FabricObject, TRANSIENT)) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (child as any).__lastModifiedTs = now;
          const { translateX: left, translateY: top, scaleX, scaleY, angle } =
            fabric.util.qrDecompose((child as fabric.FabricObject).calcTransformMatrix());
          roomBroadcast({
            type: 'delta:modified',
            id: childId,
            isGroup: child instanceof fabric.Group,
            patch: child instanceof fabric.Group
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? (child as any).toObject(EXTRAS)
              : { left, top, scaleX, scaleY, angle },
          });
        }
        return;
      }

      const id = readId(target);
      if (!id) return;
      const isGroup = target instanceof fabric.Group;
      // Record local modification time for client-side conflict resolution
      // when receiving delta:modified from other peers. §7.4
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (target as any).__lastModifiedTs = Date.now();
      roomBroadcast({
        type: 'delta:modified',
        id,
        isGroup,
        // Groups need full re-serialization (internal geometry may change).
        // Plain objects send only transform props to keep frames small. §4.2
        patch: isGroup
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (target as any).toObject(EXTRAS)
          : {
              left: target.left,
              top: target.top,
              scaleX: target.scaleX,
              scaleY: target.scaleY,
              angle: target.angle,
            },
      });
    };

    const onRemoved = ({ target }: { target: fabric.FabricObject }) => {
      if (isApplyingRemote()) return;
      // Skip undo replays that remove objects as part of an undo "add".
      if (isFlagged(target, REPLAY)) return;
      if (isFlagged(target, TRANSIENT)) return;
      const id = readId(target);
      if (!id) return; // map image and untagged objects
      roomBroadcast({ type: 'delta:removed', id });
    };

    canvas.on('object:added', onAdd);
    canvas.on('object:modified', onModified);
    canvas.on('object:removed', onRemoved);

    return () => {
      canvas.off('object:added', onAdd);
      canvas.off('object:modified', onModified);
      canvas.off('object:removed', onRemoved);
    };
  }, [maybeCanvas, roomId, roomBroadcast]);

  // === Brush color follows active operator ===
  //
  // When the active operator changes, update fabric's free-drawing
  // brush color. If no operator is active (null), fall back to
  // PENCIL_COLOR — the legacy red default. This keeps the brush
  // synchronized; usePencil reads activeOperatorId via ref-mirror
  // independently for the metadata tagging.
  useEffect(() => {
    if (!maybeCanvas?.freeDrawingBrush) return;
    maybeCanvas.freeDrawingBrush.color = activeOperator?.color ?? PENCIL_COLOR;
  }, [maybeCanvas, activeOperator?.color]);

  // === Brush arrowhead flag follows tool ===
  //
  // Drives the LIVE arrowhead preview. The OutlinedPencilBrush
  // renders a filled triangle at the end of the captured stroke
  // when its `arrowhead` flag is true. We flip it on/off whenever
  // the active tool changes between arrow and anything else. The
  // committed-arrow path:created postprocess (appendArrowhead in
  // tools/arrow.ts) handles the final mark; this flag keeps the
  // live preview consistent with the eventual commit.
  useEffect(() => {
    if (!maybeCanvas?.freeDrawingBrush) return;
    // The brush is an OutlinedPencilBrush — cast through unknown
    // to access the subclass-specific flag without importing the
    // class here (we already have it as an instance).
    const brush = maybeCanvas.freeDrawingBrush as unknown as {
      arrowhead?: boolean;
    };
    brush.arrowhead = tool.type === ToolType.arrow;
  }, [maybeCanvas, tool.type]);

  // === Brush strokeDashArray follows phase ===
  //
  // Drives the LIVE drawing preview's dash pattern. When phase is
  // 'plan', the brush's strokeDashArray is set to a zoom-compensated
  // dash so the in-progress stroke shows as dashed; when 'record',
  // it's null (solid). The resulting path inherits the same value
  // automatically via PencilBrush.createPath (see fabric source).
  //
  // Zoom-driven refreshes of the SAME setting also happen in
  // src/tools/zoom.ts (wheel-zoom) and the map-switch effect below
  // (fit-to-viewport) — those keep the live dash visually constant
  // in screen pixels as the user zooms.
  useEffect(() => {
    if (!maybeCanvas?.freeDrawingBrush) return;
    maybeCanvas.freeDrawingBrush.strokeDashArray =
      phase === "plan" ? dashArrayForZoom(maybeCanvas.getZoom()) : null;
  }, [maybeCanvas, phase]);

  // === Render composition: operator visibility + replay playhead ===
  //
  // Unified single canvas-walk that ANDs two visibility filters and
  // dispatches per-mark animators for marks currently mid-animation.
  // Replaces the standalone operator-visibility effect from P0/P1
  // — design_p2_slice.md §7 explains why combining matters
  // (ordering bugs if two effects both write obj.visible).
  //
  // Visibility rule per object:
  //   - Untagged (no __id): operator filter only. Map image lives
  //     here and stays visible regardless of playhead.
  //   - Playhead before slot start: hidden + animation reset.
  //   - Playhead past slot end: visible iff operator visible +
  //     animation reset (restores full geometry if a previous tick
  //     left it partial).
  //   - Mid-slot: visible iff operator visible; if visible, also
  //     call applyAnimation with t in (0, 1).
  //
  // Walks O(objects) on every playhead tick (RAF rate during
  // playback). At expected mark counts (< 200 per debrief) the
  // cost is dominated by applyAnimation for the one or two marks
  // currently mid-animation. See design §7.2.
  useEffect(() => {
    if (!maybeCanvas) return;
    const hidden = new Set(
      operators.filter((op) => !op.visible).map((op) => op.id),
    );
    const slotsById = new Map(timeline.slots.map((s) => [s.id, s]));
    // Logical-time projection of the playhead. The slot starts and
    // durations are stored in logical time; the playhead lives in
    // playback time. See timeline.ts §5.6 for why speed is applied
    // at the boundary rather than baked into the projection.
    const logicalPlayhead = timeline.playhead * timeline.speed;

    for (const obj of maybeCanvas.getObjects()) {
      const opId = readOperator(obj);
      const operatorVisible = opId === null || !hidden.has(opId);
      const id = readId(obj);
      const slot = id !== null ? slotsById.get(id) : undefined;

      if (!slot) {
        // Untagged objects (map image, anything without __id):
        // operator filter is the only gate.
        obj.visible = operatorVisible;
        continue;
      }

      const slotEnd = slot.logicalSlotStart + slot.logicalAnimDuration;
      if (logicalPlayhead < slot.logicalSlotStart) {
        // Not yet in slot — hide and reset any animation cache so
        // a subsequent re-entry rebuilds from current geometry.
        obj.visible = false;
        resetAnimation(obj);
      } else if (logicalPlayhead >= slotEnd) {
        // Past slot — visible per operator filter, fully rendered.
        obj.visible = operatorVisible;
        resetAnimation(obj);
      } else {
        // Mid-animation window.
        obj.visible = operatorVisible;
        if (operatorVisible) {
          const t =
            slot.logicalAnimDuration === 0
              ? 1
              : (logicalPlayhead - slot.logicalSlotStart) /
                slot.logicalAnimDuration;
          applyAnimation(obj, t);
        }
      }
    }
    maybeCanvas.requestRenderAll();
  }, [
    maybeCanvas,
    operators,
    timeline.slots,
    timeline.playhead,
    timeline.speed,
  ]);

  // === Drawing disabled during replay (R-H) ===
  //
  // When the playhead is not at live, prevent new strokes (the
  // freehand brush is dead) and selection (skipTargetFind = true).
  // On return to live, restore — including isDrawingMode if the
  // active tool is one of the freehand variants (the tool hooks
  // set isDrawingMode = true on their own effect mount, but that
  // effect doesn't re-fire when isLive flips, so we re-establish
  // here).
  //
  // Caveat: chained-mark tools (sightline, cone) whose mouse:down
  // handlers run via canvas events will still fire if the user
  // clicks the canvas while in those tools. The expected workflow
  // is to finish annotating before scrubbing; the edge case is
  // documented in §12.2 of the P2 design.
  useEffect(() => {
    if (!maybeCanvas) return;
    if (!timeline.isLive) {
      maybeCanvas.isDrawingMode = false;
      maybeCanvas.skipTargetFind = true;
    } else {
      maybeCanvas.skipTargetFind = false;
      if (
        tool.type === ToolType.pencil ||
        tool.type === ToolType.arrow
      ) {
        maybeCanvas.isDrawingMode = true;
      }
    }
  }, [maybeCanvas, timeline.isLive, tool.type]);

  // === Marker radial state (Phase 5 of design_p0_slice.md) ===
  //
  // The radial is open when `radialCenter` is non-null. We track
  // the latest cursor position over the canvas so the M-key path
  // can open the radial at the cursor; the toolbar-button path
  // passes "center" to anchor it at canvas center per §7.1.
  //
  // This block is hoisted above the keyboard bindings because one
  // of the bindings (`M`) calls openRadial.
  const [radialCenter, setRadialCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // Stored in a ref because tracking on every mouse move via
    // state would re-render the whole tree.
    const onMove = (e: MouseEvent) => {
      lastCursorRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  type RadialOrigin = "cursor" | "center";
  const computeCanvasCenter = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect)
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };
  const openRadial = useCallback((origin: RadialOrigin) => {
    if (origin === "center") {
      setRadialCenter(computeCanvasCenter());
      return;
    }
    setRadialCenter(lastCursorRef.current ?? computeCanvasCenter());
  }, []);
  const closeRadial = useCallback(() => setRadialCenter(null), []);

  const radialSlots = useMemo<(MarkerOption | null)[]>(
    () => [
      // First four positions: existing markers. Per §7.2 we cluster
      // them so future vocabulary slots (which fill the null
      // positions) can be added without rearranging.
      { url: thickPMCMarker, label: "thick PMC" },
      { url: mediumPMCMarker, label: "medium PMC" },
      { url: lightPMCMarker, label: "light PMC" },
      { url: scavMarker, label: "scav" },
      null,
      null,
      null,
      null,
    ],
    [],
  );

  const onRadialSelect = useCallback(
    (url: string) => {
      setMarkerByUrl(url);
      closeRadial();
    },
    [setMarkerByUrl, closeRadial],
  );

  // === Keyboard shortcuts (Phase 2 + 3 of design_p0_slice.md) ===
  //
  // The bindings array is recomputed every render (useMemo just
  // memoizes for reference stability when nothing relevant changed).
  // The hook reads bindings through a ref-mirror, so re-creating
  // the array does NOT re-install the window listener — see
  // useKeyboardShortcuts.ts note 1.
  //
  // (shortcutsSuspended is declared earlier, near lastArrowTipRef
  // — see the block above the operator state. It needs to be in
  // scope by the time useMark(TEXT_SPEC, …) runs so the text
  // effect can suspend tool-switching letter bindings while
  // waiting for the user's first click.)
  const previousToolRef = useRef<Tool | null>(null);
  // Hotkeys reference overlay (`?` to open). Excalidraw-style modal
  // sheet listing every shortcut. The overlay self-manages
  // suspension + focus on mount, paralleling the MarkerRadial
  // pattern; here we just gate visibility.
  const [hotkeysOpen, setHotkeysOpen] = useState<boolean>(false);

  // Space-hold pan: flip tool to pan on enter, restore on exit.
  // usePan picks up tool.type === 'pan' via its second activation
  // path (see src/tools/pan.ts path 2). The "previous tool" is
  // tracked here in a ref so the rapid keydown → React render →
  // keyup sequence doesn't lose track of the original tool.
  const enterPan = useCallback(() => {
    previousToolRef.current = tool;
    setTool({ ...tool, type: ToolType.pan });
  }, [tool]);
  const exitPan = useCallback(() => {
    const prev = previousToolRef.current;
    if (prev) setTool({ ...prev });
    previousToolRef.current = null;
  }, []);

  // Right-mouse-hold eraser. The shortcut hook calls these directly
  // on mouse:down/up; we arm the erasure session SYNCHRONOUSLY here
  // (i.e. without waiting for React state) so the triggering
  // mouse:down doesn't pass before erasing begins. See
  // src/tools/eraserCore.ts header for the rationale (R19).
  const quasiEraserSession = useRef<ReturnType<
    typeof createEraserSession
  > | null>(null);
  const enterRightMouseEraser = useCallback(() => {
    if (!maybeCanvas) return;
    // Create a fresh session per quasi-mode invocation. They're
    // cheap and short-lived; reusing across invocations would
    // require careful clean-up tracking that isn't worth it here.
    const session = createEraserSession(maybeCanvas, unerasable);
    quasiEraserSession.current = session;
    previousToolRef.current = tool;
    setTool({ ...tool, type: ToolType.eraser });
    session.start();
  }, [maybeCanvas, tool, unerasable]);
  const exitRightMouseEraser = useCallback(() => {
    quasiEraserSession.current?.stop();
    quasiEraserSession.current = null;
    const prev = previousToolRef.current;
    if (prev) setTool({ ...prev });
    previousToolRef.current = null;
  }, []);

  const bindings = useMemo<Binding[]>(
    () => [
      // Press bindings (locked-mode switches and one-shot actions).
      { kind: "press", key: "v", onPress: setSelect },
      { kind: "press", key: "b", onPress: setPencil },
      { kind: "press", key: "e", onPress: setEraser },
      // M opens the marker radial at the last known cursor
      // position (or canvas center if we don't have one yet). The
      // radial owns its own keyboard while open via the
      // shortcutsSuspended ref — see MarkerRadial.tsx item 1.
      { kind: "press", key: "m", onPress: () => openRadial("cursor") },
      // Cmd/Ctrl+Z — replaces the listener that used to live in
      // useUndo. Modifier-strict matching prevents accidental
      // Ctrl+Shift+Z double-fire (relevant once redo lands).
      {
        kind: "press",
        key: "z",
        modifiers: ["cmdOrCtrl"],
        onPress: onUndo,
      },
      // P toggles phase (record ↔ plan). See §6.2 of the design
      // doc. P-as-pencil-alias was dropped to reclaim this key;
      // B remains the pencil shortcut.
      {
        kind: "press",
        key: "p",
        onPress: () =>
          setPhase((cur) => (cur === "plan" ? "record" : "plan")),
      },
      // P1 vocabulary keys (design doc §9.2). Arrow + the point
      // marks (X, I, D) are sticky; sightline, cone, and text are
      // one-shot (the revert happens inside useMark on commit, not
      // via the binding).
      { kind: "press", key: "a", onPress: setArrow },
      { kind: "press", key: "s", onPress: setSightline },
      { kind: "press", key: "o", onPress: setCone },
      { kind: "press", key: "x", onPress: setEngagementX },
      { kind: "press", key: "i", onPress: setSoundPing },
      { kind: "press", key: "d", onPress: setPositionDot },
      { kind: "press", key: "t", onPress: setText },
      // ? opens the hotkeys reference overlay. Browsers expose
      // Shift+/ as `key = "?"` on US layouts, so we bind to `?`
      // with an explicit `shift` modifier — the modifier-strict
      // matcher in useKeyboardShortcuts requires every wanted
      // modifier to be present AND every unwanted modifier to be
      // absent, so this catches the literal `?` press without
      // accidentally firing on raw `/` or Ctrl+Shift+/.
      {
        kind: "press",
        key: "?",
        modifiers: ["shift"],
        onPress: () => setHotkeysOpen(true),
      },
      // Shift+Space toggles replay play/pause. Plain Space remains
      // bound to hold-pan below; the modifier-strict matcher in
      // useKeyboardShortcuts dispatches Shift+Space to the press
      // binding (modifiers=["shift"]) and bare Space to the hold
      // binding (which explicitly skips when any modifier is
      // held). Reads through timelineRef so this binding doesn't
      // need to re-create whenever isPlaying flips — keeps the
      // bindings useMemo deps stable.
      {
        kind: "press",
        key: " ",
        modifiers: ["shift"],
        onPress: () => {
          const t = timelineRef.current;
          if (t.isPlaying) t.pause();
          else t.play();
        },
      },
      // Space-hold pan.
      { kind: "hold", key: " ", onEnter: enterPan, onExit: exitPan },
      // Right-mouse-hold eraser.
      {
        kind: "mouseHold",
        button: 2,
        onEnter: enterRightMouseEraser,
        onExit: exitRightMouseEraser,
      },
    ],
    [
      setSelect,
      setPencil,
      setEraser,
      setArrow,
      setSightline,
      setCone,
      setEngagementX,
      setSoundPing,
      setPositionDot,
      setText,
      onUndo,
      openRadial,
      enterPan,
      exitPan,
      enterRightMouseEraser,
      exitRightMouseEraser,
    ],
  );

  useKeyboardShortcuts(maybeCanvas, {
    bindings,
    suspendedRef: shortcutsSuspended,
  });

  // showSidebar was previously wired to the toolbar marker button;
  // the radial replaces that path. `setSidebar(true)` remains
  // available via the underlying state setter for any future
  // direct caller. hideSidebar is still used by the closeArea
  // overlay so a user can dismiss the (now nearly-empty) sidebar.
  const hideSidebar = () => {
    setSidebar(false);
  };

  // === Operator chip interaction matrix (design doc §5.7) ===
  //
  // Click on visible op:        activate
  // Click on hidden op:         unhide AND activate
  // Shift+click on visible op:  hide (if active, also deactivate
  //                             to null — see §5.6 "hidden cannot
  //                             be active")
  // Shift+click on hidden op:   unhide (does not change active)
  //
  // Both handlers blur their button before App rerender — the
  // OperatorChips component handles that internally.
  const onOperatorClick = useCallback(
    (id: OperatorId) => {
      const op = operators.find((o) => o.id === id);
      if (!op) return;
      if (!op.visible) {
        // Unhide AND activate.
        setOperators((cur) =>
          cur.map((o) => (o.id === id ? { ...o, visible: true } : o)),
        );
      }
      setActiveOperatorId(id);
    },
    [operators],
  );

  const onOperatorShiftClick = useCallback(
    (id: OperatorId) => {
      const op = operators.find((o) => o.id === id);
      if (!op) return;
      const nextVisible = !op.visible;
      setOperators((cur) =>
        cur.map((o) => (o.id === id ? { ...o, visible: nextVisible } : o)),
      );
      // If we just HID the active operator, deactivate. This is the
      // load-bearing "hidden cannot be active" rule from §5.6.
      if (!nextVisible && activeOperatorId === id) {
        setActiveOperatorId(null);
      }
    },
    [operators, activeOperatorId],
  );

  // Convenience to blur a button after a toolbar click — keeps
  // canvas focus available for Space-pan (§4.4 item 11). Wrapping
  // every toolbar onClick is verbose but mechanical.
  const blurOnClick =
    (handler: () => void) =>
    (e: React.MouseEvent<HTMLButtonElement>) => {
      handler();
      (e.currentTarget as HTMLElement).blur();
    };


  // Run-once
  useEffect(() => {
    const canvas = initializeCanvas();
    setCanvas(canvas);

    // Cleanup: dispose canvas on unmount
    return () => {
      canvas.dispose();
    };
  }, []);

  // Load map and ensure it's fullscreen
  useEffect(() => {
    if (!maybeCanvas) return;
    const canvas = maybeCanvas;

    // Reset the unerasable allowlist; without this, switching maps would
    // leave the previous map's image src registered, leaking across maps.
    unerasable.clear();
    // Same lifecycle: drop the chain anchor so a sightline started
    // on map-A doesn't try to anchor at coordinates that mean
    // something different on map-B.
    lastArrowTipRef.current = null;

    fabric.Image.fromURL(maps[map]).then((image) => {
      image.canvas = canvas;
      image.selectable = false;
      unerasable.add(image.getSrc());
      canvas.add(image);

      // Fit-to-viewport on initial load and on every map switch. Image's
      // origin stays at center (fabric v7 default), so scaling around
      // (canvas.w/2, canvas.h/2) puts the image's center at the canvas
      // center and the entire map fits. We don't refit on window resize
      // — by then the user has likely zoomed/panned somewhere meaningful.
      const scale = Math.min(
        canvas.getWidth() / image.width,
        canvas.getHeight() / image.height,
      );
      canvas.setViewportTransform([
        scale,
        0,
        0,
        scale,
        canvas.getWidth() / 2,
        canvas.getHeight() / 2,
      ]);
      // Mirror zoom.ts's brush-width compensation for the fit zoom so
      // pencil strokes render at the configured screen-pixel width.
      // Existing plan-phase dashes are intentionally NOT
      // recompensated — they keep their canvas-unit dashArrays from
      // creation time and zoom with the rest of the canvas. See
      // src/tools/dashCompensation.ts header.
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = brushWidth / scale;
        // Refresh the LIVE preview's dashArray for the new zoom so
        // the next plan-phase stroke draws with screen-pixel-consistent
        // gaps. Only touch it if it's currently set — null means
        // record phase.
        if (canvas.freeDrawingBrush.strokeDashArray) {
          canvas.freeDrawingBrush.strokeDashArray = dashArrayForZoom(scale);
        }
      }
    });

    function resizeListener() {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        maybeCanvas?.setDimensions({ width, height });
      } else {
        maybeCanvas?.setDimensions(defaultSize);
      }
    }

    resizeListener();

    window.addEventListener("resize", resizeListener);
    return () => {
      window.removeEventListener("resize", resizeListener);
    };
  }, [map, maybeCanvas, unerasable]);

  return (
    <div className="App" ref={appRef}>
      <header className="App-header">
        <section className="App-header-left">
          <Link className="App-header-title" to="/">
            Tarkov Debrief
          </Link>
          <a href={githubUrl}>
            <img src={githubLogo} alt="github logo" className="App-header-github-logo"/>
          </a>
          <a href={githubUrl} className="App-header-github">Read more on github</a>
        </section>
        {/* Middle section: operator chips + phase toggle. Centered
            via App.css's three-section flex (header-middle:flex-1
            with content centered). See design doc §5.7. */}
        <section className="App-header-middle">
          <OperatorChips
            operators={operators}
            activeId={activeOperatorId}
            onClick={onOperatorClick}
            onShiftClick={onOperatorShiftClick}
            peers={peers}
          />
          <PhaseToggle phase={phase} onChange={setPhase} />
        </section>
        {/* Toolbar buttons. Each onClick is wrapped in blurOnClick
            so canvas focus returns after a click and Space-pan keeps
            working on the next press (§4.4 item 11, R16). */}
        <section className="App-header-buttons">
          <button onClick={blurOnClick(setSelect)} title="Select (V)">
            <img src={selectIcon} alt="select" />
          </button>
          <button onClick={blurOnClick(setPencil)} title="Pencil (B)">
            <img src={pencilIcon} alt="pencil" />
          </button>
          <button onClick={blurOnClick(setEraser)} title="Eraser (E)">
            <img src={eraserIcon} alt="eraser" />
          </button>
          <button
            onClick={blurOnClick(() => openRadial("center"))}
            title="Markers (M)"
          >
            <img src={addMarkerIcon} alt="markers" />
          </button>
          <button onClick={blurOnClick(onUndo)} title="Undo (Ctrl/Cmd+Z)">
            <img src={undoIcon} alt="undo" />
          </button>
          <button onClick={blurOnClick(save)} title="Save">
            <img
              className="App-header-buttons-save"
              src={saveIcon}
              alt="save"
            />
          </button>
        </section>
      </header>
      {/* P3 room status bar. Sits between header and canvas so it doesn't
          disrupt the existing header layout. Hidden when not in use via the
          compact single-row height. See design_p3_multiplayer.md §9.2. */}
      <RoomBar
        roomId={roomId}
        status={roomStatus}
        peerCount={peers.length + 1}
        onChange={handleRoomChange}
      />
      {/* Sidebar stays as a stub for the color picker only — the
          marker section moved to the radial below. Full removal
          of the sidebar (and the react-color dep) is tech debt
          queued in design doc §8.4. */}
      <aside className={sidebar ? "enter" : ""}>
        <section onClick={hideSidebar} id="closeArea"></section>
        <section id="sidebar">
          <SidebarSection title="">
            <TwitterPicker
              color={color}
              triangle="hide"
              onChangeComplete={onColorChoice}
            ></TwitterPicker>
          </SidebarSection>
        </section>
      </aside>
      <div className="Canvas" ref={containerRef} tabIndex={0}>
        <canvas id="canvas"></canvas>
        {/* P2: replay scrubber. Positioned absolutely inside .Canvas
            so it overlays the bottom of the viewport. Self-hides
            when the timeline is empty. See
            src/components/Scrubber.tsx and design_p2_slice.md §8. */}
        <Scrubber timeline={timeline} />
        {/* P3.3: ghost cursor overlay. Only rendered when peers are present
            with cursor positions. pointer-events:none — passes through to
            canvas. Coordinate conversion uses the full viewportTransform
            matrix (not just zoom) to handle pan correctly. §9.1 */}
        <GhostCursorLayer
          peers={peers}
          operators={operators}
          viewportTransform={viewportTransform}
        />
        {/* P3.5: join-flow toast. Appears once on room join, auto-dismisses
            after 3 s. pointer-events:none so it doesn't block canvas input. §11.2 */}
        {joinToastName && (
          <div className="JoinToast" role="status" aria-live="polite">
            You&apos;re drawing as {joinToastName} — tap a chip to change.
          </div>
        )}
      </div>
      {radialCenter && (
        <MarkerRadial
          center={radialCenter}
          slots={radialSlots}
          onSelect={onRadialSelect}
          onCancel={closeRadial}
          suspendedRef={shortcutsSuspended}
        />
      )}
      <HotkeysOverlay
        open={hotkeysOpen}
        onClose={() => setHotkeysOpen(false)}
        suspendedRef={shortcutsSuspended}
      />
    </div>
  );
}

export default App;
