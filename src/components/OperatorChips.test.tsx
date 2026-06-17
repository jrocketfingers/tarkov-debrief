import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OperatorChips } from "./OperatorChips";
import { DEFAULT_OPERATORS } from "@/state/operators";
import type { PeerInfo } from "@/collab/protocol";

describe("OperatorChips", () => {
  it("renders one button per operator", () => {
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
      />,
    );
    for (const op of DEFAULT_OPERATORS) {
      // Use accessible name via aria-label to disambiguate
      expect(
        screen.getByRole("button", { name: new RegExp(op.name) }),
      ).toBeInTheDocument();
    }
  });

  it("marks the active operator as aria-pressed", () => {
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={DEFAULT_OPERATORS[1].id}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
      />,
    );
    const active = screen.getByRole("button", {
      name: DEFAULT_OPERATORS[1].name,
    });
    expect(active).toHaveAttribute("aria-pressed", "true");
  });

  it("plain click invokes onClick with the operator id", () => {
    const onClick = vi.fn();
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={onClick}
        onShiftClick={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_OPERATORS[0].name }),
    );
    expect(onClick).toHaveBeenCalledWith(DEFAULT_OPERATORS[0].id);
  });

  it("shift+click invokes onShiftClick (visibility toggle path)", () => {
    const onShiftClick = vi.fn();
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={onShiftClick}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: DEFAULT_OPERATORS[2].name }),
      { shiftKey: true },
    );
    expect(onShiftClick).toHaveBeenCalledWith(DEFAULT_OPERATORS[2].id);
  });

  // ---- P3.5: peer badges ------------------------------------------------

  it("renders no badges when peers prop is omitted", () => {
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
      />,
    );
    expect(document.querySelectorAll(".OperatorChip-badge")).toHaveLength(0);
  });

  it("renders a badge on the chip claimed by a peer", () => {
    const peers: PeerInfo[] = [
      { id: "bob", operatorId: DEFAULT_OPERATORS[0].id, cursor: null },
    ];
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
        peers={peers}
      />,
    );
    // Badge appears only on the Alpha chip.
    expect(
      screen.getAllByTestId(`chip-badge-${DEFAULT_OPERATORS[0].id}`),
    ).toHaveLength(1);
    // No badge on other chips.
    expect(
      screen.queryByTestId(`chip-badge-${DEFAULT_OPERATORS[1].id}`),
    ).toBeNull();
  });

  it("renders multiple badges when multiple peers claim the same chip", () => {
    const peers: PeerInfo[] = [
      { id: "bob", operatorId: DEFAULT_OPERATORS[0].id, cursor: null },
      { id: "carol", operatorId: DEFAULT_OPERATORS[0].id, cursor: null },
    ];
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
        peers={peers}
      />,
    );
    expect(
      screen.getAllByTestId(`chip-badge-${DEFAULT_OPERATORS[0].id}`),
    ).toHaveLength(2);
  });

  it("updates aria-label to include peer count when chip is claimed", () => {
    const peers: PeerInfo[] = [
      { id: "bob", operatorId: DEFAULT_OPERATORS[1].id, cursor: null },
    ];
    render(
      <OperatorChips
        operators={DEFAULT_OPERATORS}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
        peers={peers}
      />,
    );
    const chip = screen.getByRole("button", {
      name: new RegExp(`${DEFAULT_OPERATORS[1].name}.*1 peer`),
    });
    expect(chip).toBeTruthy();
  });

  it("renders hidden state with the aria label and visual class", () => {
    const operators = DEFAULT_OPERATORS.map((op, i) =>
      i === 0 ? { ...op, visible: false } : op,
    );
    render(
      <OperatorChips
        operators={operators}
        activeId={null}
        onClick={vi.fn()}
        onShiftClick={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: `${operators[0].name} (hidden)`,
      }),
    ).toHaveClass("hidden");
  });
});
