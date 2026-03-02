import { ble } from './connection.ts';
import { CHAR_LOG_STREAM, LOG_STREAM_END_MARKER } from './constants.ts';
import { parseLogCell } from './parsers.ts';
import type { LogCell } from '../types/index.ts';

export interface LogStreamProgress {
  received: number;
  total: number;
}

/**
 * Stream log cells from the device via BLE notifications.
 *
 * Writes {startCell, count} to char 0x0006, receives cell notifications,
 * calls onCell for each cell received, calls onProgress for UI updates,
 * resolves when end marker (0xFFFFFFFF) is received or all cells are collected.
 */
export async function streamLogCells(
  startCell: number,
  count: number,
  onCell: (cell: LogCell) => void,
  onProgress?: (progress: LogStreamProgress) => void,
): Promise<LogCell[]> {
  if (!ble.customService) throw new Error('Not connected');

  const char = await ble.customService.getCharacteristic(CHAR_LOG_STREAM);
  const cells: LogCell[] = [];

  return new Promise<LogCell[]>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeout);
      char.removeEventListener('characteristicvaluechanged', handler);
      char.stopNotifications().catch(() => {});
    };

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        // Resolve with what we have if we timeout (device may have stopped early)
        resolve(cells);
      }, 10000);
    };

    const handler = (e: Event) => {
      const target = e.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;

      resetTimeout();
      const dv = target.value;

      // Check for end marker (4-byte notification with 0xFFFFFFFF)
      if (dv.byteLength === 4 && dv.getUint32(0, true) === LOG_STREAM_END_MARKER) {
        cleanup();
        resolve(cells);
        return;
      }

      try {
        const cell = parseLogCell(dv);
        cells.push(cell);
        onCell(cell);
        onProgress?.({ received: cells.length, total: count });
      } catch (err) {
        console.error('Failed to parse log cell:', err);
      }
    };

    char.addEventListener('characteristicvaluechanged', handler);

    char.startNotifications()
      .then(() => {
        // Write the stream request: {start_cell: u32, count: u32}
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, startCell, true);
        view.setUint32(4, count, true);
        return char.writeValue(buf);
      })
      .then(() => {
        resetTimeout();
      })
      .catch((err: unknown) => {
        cleanup();
        reject(err);
      });
  });
}
