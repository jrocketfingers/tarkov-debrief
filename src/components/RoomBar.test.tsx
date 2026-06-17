import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomBar } from './RoomBar';

const VALID_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('RoomBar', () => {
  it('renders the room label', () => {
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={vi.fn()} />);
    expect(screen.getByText('Room')).toBeDefined();
  });

  it('shows "New" button when not in a room', () => {
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new/i })).toBeDefined();
  });

  it('shows "Copy link" and "Leave" buttons when in a room', () => {
    render(<RoomBar roomId={VALID_UUID} status="connected" peerCount={2} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /leave/i })).toBeDefined();
  });

  it('"New" calls onChange with a UUID v4', () => {
    const onChange = vi.fn();
    vi.stubGlobal('crypto', {
      randomUUID: () => VALID_UUID,
    });
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    expect(onChange).toHaveBeenCalledWith(VALID_UUID);
    vi.unstubAllGlobals();
  });

  it('"Leave" calls onChange with null', () => {
    const onChange = vi.fn();
    render(<RoomBar roomId={VALID_UUID} status="connected" peerCount={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows peer count when connected', () => {
    render(<RoomBar roomId={VALID_UUID} status="connected" peerCount={3} onChange={vi.fn()} />);
    expect(screen.getByText(/3 peers/i)).toBeDefined();
  });

  it('shows singular "peer" for count 1', () => {
    render(<RoomBar roomId={VALID_UUID} status="connected" peerCount={1} onChange={vi.fn()} />);
    expect(screen.getByText('1 peer')).toBeDefined();
  });

  it('shows "offline" status when idle', () => {
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={vi.fn()} />);
    expect(screen.getByText('offline')).toBeDefined();
  });

  it('calls onChange when a valid UUID is pasted into the input', () => {
    const onChange = vi.fn();
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /room id/i });
    fireEvent.change(input, { target: { value: VALID_UUID } });
    expect(onChange).toHaveBeenCalledWith(VALID_UUID);
  });

  it('calls onChange with null when input is cleared', () => {
    const onChange = vi.fn();
    render(<RoomBar roomId={VALID_UUID} status="connected" peerCount={0} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /room id/i });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not call onChange for a partial/invalid UUID', () => {
    const onChange = vi.fn();
    render(<RoomBar roomId={null} status="idle" peerCount={0} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /room id/i });
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
