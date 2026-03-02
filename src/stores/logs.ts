import { create } from 'zustand';
import { streamLogCells } from '../ble/log-stream.ts';
import { readCellCount } from '../ble/characteristics.ts';
import { saveLogCells, getAllLogCells, getMaxCachedCellNumber, getCachedCellCount, clearLogCells } from '../lib/db.ts';
import type { LogCell } from '../types/index.ts';

interface LogState {
  cells: LogCell[];
  isStreaming: boolean;
  streamProgress: { received: number; total: number } | null;
  cachedCount: number;
  error: string | null;

  loadCachedCells: () => Promise<void>;
  downloadNewCells: () => Promise<void>;
  downloadNewCellsQuiet: () => Promise<void>;
  clearCache: () => Promise<void>;
}

export const useLogStore = create<LogState>((set, get) => ({
  cells: [],
  isStreaming: false,
  streamProgress: null,
  cachedCount: 0,
  error: null,

  loadCachedCells: async () => {
    try {
      const cells = await getAllLogCells();
      const cachedCount = cells.length;
      set({ cells, cachedCount });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  downloadNewCells: async () => {
    if (get().isStreaming) return;
    set({ isStreaming: true, streamProgress: null, error: null });

    try {
      const deviceCellCount = await readCellCount();
      const maxCached = await getMaxCachedCellNumber();

      const startCell = maxCached + 1;
      // deviceCellCount is last cell index (not total count), so +1 to include it
      const count = deviceCellCount - startCell + 1;

      if (count <= 0) {
        set({ isStreaming: false, streamProgress: null });
        return;
      }

      const newCells: LogCell[] = [];
      await streamLogCells(
        startCell,
        count,
        (cell) => { newCells.push(cell); },
        (progress) => { set({ streamProgress: progress }); },
      );

      await saveLogCells(newCells);

      // Merge with existing
      const allCells = await getAllLogCells();
      const cachedCount = await getCachedCellCount();
      set({ cells: allCells, cachedCount, isStreaming: false, streamProgress: null });
    } catch (err) {
      set({ error: (err as Error).message, isStreaming: false, streamProgress: null });
    }
  },

  // Silent background download — no error banner, no progress bar.
  // Used by the auto-poll timer on the History page.
  downloadNewCellsQuiet: async () => {
    if (get().isStreaming) return;
    set({ isStreaming: true });

    try {
      const deviceCellCount = await readCellCount();
      const maxCached = await getMaxCachedCellNumber();

      const startCell = maxCached + 1;
      const count = deviceCellCount - startCell + 1;

      if (count <= 0) {
        set({ isStreaming: false });
        return;
      }

      const newCells: LogCell[] = [];
      await streamLogCells(startCell, count, (cell) => { newCells.push(cell); });

      await saveLogCells(newCells);

      const allCells = await getAllLogCells();
      const cachedCount = await getCachedCellCount();
      set({ cells: allCells, cachedCount, isStreaming: false });
    } catch {
      // Fail silently — will retry on next interval
      set({ isStreaming: false });
    }
  },

  clearCache: async () => {
    await clearLogCells();
    set({ cells: [], cachedCount: 0 });
  },
}));
