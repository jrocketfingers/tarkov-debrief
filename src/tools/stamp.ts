// Stamp tool: places markers (PMC, Scav, etc) at click points.
//
// Two entry points:
//
//   1. Legacy DOM-event flow (Phase 3): `onChoiceFromEvent(evt)`
//      reads the marker URL off the clicked <img>'s src. This is
//      how the current sidebar marker buttons drive selection
//      until the radial replaces them in Phase 5.
//
//   2. URL flow (Phase 5): `selectMarker(url)` takes a URL string
//      directly. The MarkerRadial component uses this — it has
//      no DOM event to read from. Both flows eventually set the
//      same `markerUrlRef`.
//
// Button-reservation contract: placement only fires on LEFT clicks
// (e.button === 0). Right-button is reserved for the quasi-eraser
// (see design doc §4.5). Without this gate, a right-click in
// marker mode would drop a marker BEFORE the quasi-eraser took
// over — R15 in the design doc.
//
// Design references:
//   - claudedocs/design_p0_slice.md §4.5 (button reservation)
//   - claudedocs/design_p0_slice.md §8.2 (signature change rationale)

import * as fabric from "fabric";
import { useCallback, useEffect, useRef } from "react";
import { SetToolFn, Tool, ToolType } from "./tool";
import { tagObject } from "./metadata";
import type { OperatorId } from "../state/operators";
import type { Phase } from "../state/phase";

export const useStamp = (
  canvas: fabric.Canvas | null,
  setSidebar: (visible: boolean) => void,
  tool: Tool,
  setTool: SetToolFn,
  activeOperatorId: OperatorId | null = null,
  phase: Phase = "record",
) => {
  const markerUrlRef = useRef<string>("");
  // Ref-mirror so the async placeMarker handler always reads the current
  // operator/phase without needing to re-register on every change.
  const operatorRef = useRef(activeOperatorId);
  const phaseRef = useRef(phase);
  operatorRef.current = activeOperatorId;
  phaseRef.current = phase;
  const cacheRef = useRef<Record<string, fabric.Image>>({});

  // Core: set the active marker URL, update cursor, enter marker
  // mode. Both onChoiceFromEvent and selectMarker funnel here.
  const enterMarkerMode = useCallback(
    (url: string) => {
      markerUrlRef.current = url;
      const cursorString = `url("${url}"), auto`;
      if (canvas) {
        canvas.defaultCursor = cursorString;
        canvas.hoverCursor = cursorString;
      }
      setTool({ ...tool, type: ToolType.marker });
    },
    [canvas, setTool, tool],
  );

  // Phase-3 entry: the existing sidebar marker grid drives this.
  // Reads URL from the clicked <img>'s src. Closes the sidebar as
  // part of the flow because the sidebar was the picker.
  const onChoice = useCallback(
    (evt: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      const target = evt.target as HTMLImageElement;
      enterMarkerMode(target.src);
      setSidebar(false);
    },
    [enterMarkerMode, setSidebar],
  );

  // Phase-5 entry: the radial calls this with a URL string. It
  // does NOT close the sidebar (the radial isn't the sidebar) but
  // we still call setSidebar(false) defensively — if the sidebar
  // happens to be open for some unrelated reason, closing it
  // matches the existing flow's behavior. Safe no-op if already
  // closed.
  const selectMarker = useCallback(
    (url: string) => {
      enterMarkerMode(url);
      setSidebar(false);
    },
    [enterMarkerMode, setSidebar],
  );

  useEffect(() => {
    if (!canvas || tool.type !== ToolType.marker) return;

    const placeMarker = async (evt: { e: MouseEvent | TouchEvent }) => {
      // Button-reservation contract (§4.5): only act on left
      // button. Right button belongs to the quasi-eraser; without
      // this gate, the user would get an unwanted stamp + the
      // eraser would arm afterward (R15).
      const me = evt.e as MouseEvent;
      if (typeof me.button === "number" && me.button !== 0) return;
      // Alt-click is a legacy escape hatch (e.g., "I don't want
      // to place right now") — predates this slice; preserved as
      // a no-op so existing muscle memory keeps working.
      if (me.altKey) return;
      const url = markerUrlRef.current;
      if (!url) return;

      let cached = cacheRef.current[url];
      if (!cached) {
        cached = await fabric.Image.fromURL(url);
        cacheRef.current[url] = cached;
      }

      const image = await cached.clone();
      // Pin to top-left so the cursor's hotspot lands at the marker
      // corner. fabric v7 changed the default origin from top-left
      // to center; see the regression note in e2e/smoke.spec.ts.
      image.set({ originX: "left", originY: "top" });

      const pointer = canvas.getScenePoint(evt.e);
      image.left = pointer.x;
      image.top = pointer.y;
      image.scale(1 / canvas.getZoom());

      // Tag before add so the broadcast effect sees __id immediately.
      tagObject(image, operatorRef.current, phaseRef.current);
      canvas.add(image);
    };

    canvas.on("mouse:down", placeMarker);
    return () => {
      canvas.off("mouse:down", placeMarker);
      canvas.defaultCursor = "auto";
      canvas.hoverCursor = "auto";
    };
  }, [canvas, tool.type]);

  return { onChoice, selectMarker };
};
