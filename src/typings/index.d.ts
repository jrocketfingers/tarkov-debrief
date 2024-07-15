import 'fabric';

// extend fabric.Canvas with fabric-history methods and attributes
declare module 'fabric' {
  interface Canvas {
    historyUndo: string[];
    historyRedo: string[];
    historyProcessing: boolean;
    extraProps: string[];
    historyNextState: string;

    _historyNext(): string;
    _historyEvents(): { [key: string]: (e: any) => void };
    _historyInit(): void;
    _historyDispose(): void;
    _historySaveAction(e?: any): void;
    undo(callback?: () => void): void;
    redo(callback?: () => void): void;
    _loadHistory(history: string, event: string, callback?: () => void): void;
    clearHistory(): void;
    onHistory(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    offHistory(): void;
  }
}
