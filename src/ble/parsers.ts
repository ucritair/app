import { RTC_EPOCH_TIME_OFFSET } from './constants.ts';
import type { LogCell, StroopData, PetStats, DeviceConfig, SensorValues } from '../types/index.ts';

/** Parse IEEE 754 half-precision (binary16) float from two bytes (little-endian). */
export function parseFloat16(b0: number, b1: number): number {
  const val = b0 | (b1 << 8);
  const sign = (val >> 15) & 1;
  const exp = (val >> 10) & 0x1f;
  const frac = val & 0x3ff;
  if (exp === 0) {
    // Subnormal
    return (sign ? -1 : 1) * (frac / 1024) * 2 ** -14;
  }
  if (exp === 31) {
    return frac ? NaN : (sign ? -Infinity : Infinity);
  }
  return (sign ? -1 : 1) * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** Parse ESS Temperature: sint16, 0.01°C resolution → °C */
export function parseTemperature(data: DataView): number {
  return data.getInt16(0, true) / 100;
}

/** Parse ESS Humidity: uint16, 0.01% resolution → % */
export function parseHumidity(data: DataView): number {
  return data.getUint16(0, true) / 100;
}

/** Parse ESS Pressure: uint32, 0.1 Pa resolution → hPa */
export function parsePressure(data: DataView): number {
  return data.getUint32(0, true) / 1000;
}

/** Parse ESS CO2: uint16, ppm */
export function parseCO2(data: DataView): number {
  return data.getUint16(0, true);
}

/** Parse ESS PM (fp16): half-precision float → µg/m³ */
export function parsePM(data: DataView): number {
  return parseFloat16(data.getUint8(0), data.getUint8(1));
}

/** Convert internal RTC timestamp (seconds) to Unix timestamp (seconds). */
export function rtcToUnix(rtcTime: bigint): number {
  return Number(rtcTime - RTC_EPOCH_TIME_OFFSET);
}

/** Parse a log cell from BLE notification payload (57 bytes: 4-byte cell_nr + 53-byte cell data). */
export function parseLogCell(data: DataView): LogCell {
  const cellNumber = data.getUint32(0, true);

  // Cell data starts at offset 4
  const o = 4;
  const flags = data.getUint8(o + 0);

  // timestamp: uint64 at offset 4 (relative to cell start)
  const tsLow = data.getUint32(o + 4, true);
  const tsHigh = data.getUint32(o + 8, true);
  const rtcTimestamp = (BigInt(tsHigh) << 32n) | BigInt(tsLow);
  const timestamp = rtcToUnix(rtcTimestamp);

  const temperature = data.getInt32(o + 12, true) / 1000;
  const pressure = data.getUint16(o + 16, true) / 10;
  const humidity = data.getUint16(o + 18, true) / 100;
  const co2 = data.getUint16(o + 20, true);

  const pm: [number, number, number, number] = [
    data.getUint16(o + 22, true) / 100, // PM1.0
    data.getUint16(o + 24, true) / 100, // PM2.5
    data.getUint16(o + 26, true) / 100, // PM4.0
    data.getUint16(o + 28, true) / 100, // PM10.0
  ];

  const pn: [number, number, number, number, number] = [
    data.getUint16(o + 30, true) / 100, // PN0.5
    data.getUint16(o + 32, true) / 100, // PN1.0
    data.getUint16(o + 34, true) / 100, // PN2.5
    data.getUint16(o + 36, true) / 100, // PN4.0
    data.getUint16(o + 38, true) / 100, // PN10.0
  ];

  const voc = data.getUint8(o + 40);
  const nox = data.getUint8(o + 41);
  const co2Uncomp = data.getUint16(o + 42, true);

  const stroop: StroopData = {
    meanTimeCong: data.getFloat32(o + 44, true),
    meanTimeIncong: data.getFloat32(o + 48, true),
    throughput: data.getUint8(o + 52),
  };

  return {
    cellNumber, flags, timestamp, temperature, pressure, humidity, co2,
    pm, pn, voc, nox, co2Uncomp, stroop,
  };
}

/** Parse pet stats from 6-byte characteristic read. */
export function parseStats(data: DataView): PetStats {
  return {
    vigour: data.getUint8(0),
    focus: data.getUint8(1),
    spirit: data.getUint8(2),
    age: data.getUint16(3, true),
    interventions: data.getUint8(5),
  };
}

/** Parse device config from 16-byte characteristic read. */
export function parseConfig(data: DataView): DeviceConfig {
  const flagsLow = data.getUint32(8, true);
  const flagsHigh = data.getUint32(12, true);
  return {
    sensorWakeupPeriod: data.getUint16(0, true),
    sleepAfterSeconds: data.getUint16(2, true),
    dimAfterSeconds: data.getUint16(4, true),
    noxSamplePeriod: data.getUint8(6),
    screenBrightness: data.getUint8(7),
    persistFlags: (BigInt(flagsHigh) << 32n) | BigInt(flagsLow),
  };
}

/** Serialize device config to 16 bytes for writing. */
export function serializeConfig(config: DeviceConfig): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  view.setUint16(0, config.sensorWakeupPeriod, true);
  view.setUint16(2, config.sleepAfterSeconds, true);
  view.setUint16(4, config.dimAfterSeconds, true);
  view.setUint8(6, config.noxSamplePeriod);
  view.setUint8(7, config.screenBrightness);
  view.setUint32(8, Number(config.persistFlags & 0xFFFFFFFFn), true);
  view.setUint32(12, Number((config.persistFlags >> 32n) & 0xFFFFFFFFn), true);
  return buf;
}

/** Parse sensor values from a complete set of ESS reads. */
export function emptySensorValues(): SensorValues {
  return {
    temperature: null, humidity: null, co2: null,
    pm1_0: null, pm2_5: null, pm4_0: null, pm10: null,
    pressure: null, voc: null, nox: null,
  };
}
