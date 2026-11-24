import type { BoardElement } from '@scripta/shared';

export interface ErasedEntry {
  index: number;
  element: BoardElement;
}

export interface ElementPatch {
  before: BoardElement;
  after: BoardElement;
}

export type HistoryCommand =
  | { type: 'add'; element: BoardElement }
  | { type: 'erase'; removed: ErasedEntry[] }
  | { type: 'clear'; previous: BoardElement[] }
  | { type: 'patch'; patches: ElementPatch[] };

const MAX_HISTORY = 200;

/**
 * Undo/redo command stack operating on the desktop elements array in place.
 */
export class CommandHistory {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(cmd: HistoryCommand): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(elements: BoardElement[]): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;

    switch (cmd.type) {
      case 'add': {
        const idx = elements.findIndex((el) => el.id === cmd.element.id);
        if (idx !== -1) elements.splice(idx, 1);
        break;
      }
      case 'erase': {
        const sorted = [...cmd.removed].sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          const targetIdx = Math.min(item.index, elements.length);
          elements.splice(targetIdx, 0, item.element);
        }
        break;
      }
      case 'clear': {
        elements.splice(0, elements.length, ...cmd.previous);
        break;
      }
      case 'patch': {
        const byId = new Map(cmd.patches.map((p) => [p.after.id, p.before]));
        for (let i = 0; i < elements.length; i++) {
          const prev = byId.get(elements[i].id);
          if (prev) elements[i] = prev;
        }
        break;
      }
    }

    this.redoStack.push(cmd);
    return true;
  }

  redo(elements: BoardElement[]): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;

    switch (cmd.type) {
      case 'add': {
        elements.push(cmd.element);
        break;
      }
      case 'erase': {
        const toRemove = new Set(cmd.removed.map((r) => r.element.id));
        for (let i = elements.length - 1; i >= 0; i--) {
          if (toRemove.has(elements[i].id)) elements.splice(i, 1);
        }
        break;
      }
      case 'clear': {
        elements.length = 0;
        break;
      }
      case 'patch': {
        const byId = new Map(cmd.patches.map((p) => [p.before.id, p.after]));
        for (let i = 0; i < elements.length; i++) {
          const next = byId.get(elements[i].id);
          if (next) elements[i] = next;
        }
        break;
      }
    }

    this.undoStack.push(cmd);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
