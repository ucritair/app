import { openDB, type IDBPDatabase } from 'idb';
import type { LogCell } from '../types/index.ts';

const DB_NAME = 'ucrit-webapp';
const DB_VERSION = 1;
const STORE_NAME = 'log_cells';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cellNumber' });
        }
      },
    });
  }
  return dbPromise;
}

/** Save a single log cell to IndexedDB. */
export async function saveLogCell(cell: LogCell): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, cell);
}

/** Save multiple log cells to IndexedDB. */
export async function saveLogCells(cells: LogCell[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const cell of cells) {
    tx.store.put(cell);
  }
  await tx.done;
}

/** Get a single log cell by cell number. */
export async function getLogCell(cellNumber: number): Promise<LogCell | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, cellNumber);
}

/** Get all cached log cells, sorted by cell number. */
export async function getAllLogCells(): Promise<LogCell[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

/** Get count of cached log cells. */
export async function getCachedCellCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

/** Get the highest cached cell number. */
export async function getMaxCachedCellNumber(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const cursor = await tx.store.openCursor(null, 'prev');
  if (cursor) {
    return (cursor.value as LogCell).cellNumber;
  }
  return -1;
}

/** Clear all cached log cells. */
export async function clearLogCells(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE_NAME);
}
