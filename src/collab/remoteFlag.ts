// Module-level flag: true while a remote canvas delta is being applied.
//
// Shared between useRemoteCanvas (writes it), useUndo (reads it to skip
// stack push), and the App.tsx broadcast effect (reads it to skip re-
// broadcasting back to the room). A module flag rather than a per-object
// sentinel because the per-object approach would permanently mark objects
// and break local modifications after any remote edit — see §7.1 of
// design_p3_multiplayer.md for the full rationale.
let _applyingRemote = false;

export function isApplyingRemote(): boolean {
  return _applyingRemote;
}

export function setApplyingRemote(value: boolean): void {
  _applyingRemote = value;
}
