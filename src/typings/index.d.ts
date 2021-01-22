declare namespace fabric {
  /**
   * fabric-history interface
   */
  export interface Canvas {
    undo(): void
    redo(): void
    clearHistory(): void
  }
}