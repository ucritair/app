import { ble } from './connection.ts';
import {
  CHAR_DEVICE_NAME, CHAR_TIME, CHAR_CELL_COUNT, CHAR_CELL_SELECTOR,
  CHAR_CELL_DATA, CHAR_STATS, CHAR_ITEMS_OWNED, CHAR_ITEMS_PLACED,
  CHAR_BONUS, CHAR_PET_NAME, CHAR_DEVICE_CONFIG,
} from './constants.ts';
import { parseLogCell, parseStats, parseConfig, serializeConfig } from './parsers.ts';
import type { LogCell, PetStats, DeviceConfig } from '../types/index.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Read device name string. */
export async function readDeviceName(): Promise<string> {
  const dv = await ble.readCharacteristic(CHAR_DEVICE_NAME);
  return decoder.decode(dv.buffer).replace(/\0+$/, '');
}

/** Write device name string. */
export async function writeDeviceName(name: string): Promise<void> {
  await ble.writeCharacteristic(CHAR_DEVICE_NAME, encoder.encode(name).buffer);
}

/** Read device time as Unix timestamp (seconds). */
export async function readTime(): Promise<number> {
  const dv = await ble.readCharacteristic(CHAR_TIME);
  return dv.getUint32(0, true);
}

/** Write device time (Unix timestamp seconds). */
export async function writeTime(unixSeconds: number): Promise<void> {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, unixSeconds, true);
  await ble.writeCharacteristic(CHAR_TIME, buf);
}

/** Read total log cell count. */
export async function readCellCount(): Promise<number> {
  const dv = await ble.readCharacteristic(CHAR_CELL_COUNT);
  return dv.getUint32(0, true);
}

/** Set cell selector index. */
export async function writeCellSelector(index: number): Promise<void> {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, index, true);
  await ble.writeCharacteristic(CHAR_CELL_SELECTOR, buf);
}

/** Read selected cell data. */
export async function readCellData(): Promise<LogCell> {
  const dv = await ble.readCharacteristic(CHAR_CELL_DATA);
  return parseLogCell(dv);
}

/** Read pet stats. */
export async function readStats(): Promise<PetStats> {
  const dv = await ble.readCharacteristic(CHAR_STATS);
  return parseStats(dv);
}

/** Read items owned bitmap (32 bytes = 256 bits). */
export async function readItemsOwned(): Promise<Uint8Array> {
  const dv = await ble.readCharacteristic(CHAR_ITEMS_OWNED);
  return new Uint8Array(dv.buffer);
}

/** Read items placed bitmap. */
export async function readItemsPlaced(): Promise<Uint8Array> {
  const dv = await ble.readCharacteristic(CHAR_ITEMS_PLACED);
  return new Uint8Array(dv.buffer);
}

/** Read bonus value. */
export async function readBonus(): Promise<number> {
  const dv = await ble.readCharacteristic(CHAR_BONUS);
  return dv.getUint32(0, true);
}

/** Write bonus value. */
export async function writeBonus(value: number): Promise<void> {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  await ble.writeCharacteristic(CHAR_BONUS, buf);
}

/** Read pet name string. */
export async function readPetName(): Promise<string> {
  const dv = await ble.readCharacteristic(CHAR_PET_NAME);
  return decoder.decode(dv.buffer).replace(/\0+$/, '');
}

/** Write pet name string. */
export async function writePetName(name: string): Promise<void> {
  await ble.writeCharacteristic(CHAR_PET_NAME, encoder.encode(name).buffer);
}

/** Read device configuration. */
export async function readDeviceConfig(): Promise<DeviceConfig> {
  const dv = await ble.readCharacteristic(CHAR_DEVICE_CONFIG);
  return parseConfig(dv);
}

/** Write device configuration. */
export async function writeDeviceConfig(config: DeviceConfig): Promise<void> {
  await ble.writeCharacteristic(CHAR_DEVICE_CONFIG, serializeConfig(config));
}

/** Count set bits in a bitmap. */
export function countBitmapItems(bitmap: Uint8Array): number {
  let count = 0;
  for (const byte of bitmap) {
    let b = byte;
    while (b) { count += b & 1; b >>= 1; }
  }
  return count;
}
