export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface SensorValues {
  temperature: number | null;    // °C
  humidity: number | null;       // %
  co2: number | null;            // ppm
  pm1_0: number | null;          // µg/m³
  pm2_5: number | null;          // µg/m³
  pm4_0: number | null;          // µg/m³
  pm10: number | null;           // µg/m³
  pressure: number | null;       // hPa
  voc: number | null;            // index 0-510
  nox: number | null;            // index 0-255
}

export interface SensorReading extends SensorValues {
  timestamp: number; // Unix ms
}

export interface LogCell {
  cellNumber: number;
  flags: number;
  timestamp: number;          // Unix seconds
  temperature: number;        // °C
  pressure: number;           // hPa
  humidity: number;           // %
  co2: number;                // ppm
  pm: [number, number, number, number];     // PM1.0, PM2.5, PM4.0, PM10.0 µg/m³
  pn: [number, number, number, number, number]; // PN0.5, PN1.0, PN2.5, PN4.0, PN10.0 1/cm³
  voc: number;                // index
  nox: number;                // index
  co2Uncomp: number;          // ppm (uncompensated)
  stroop: StroopData;
}

export interface StroopData {
  meanTimeCong: number;
  meanTimeIncong: number;
  throughput: number;
}

export interface PetStats {
  vigour: number;
  focus: number;
  spirit: number;
  age: number;
  interventions: number;
}

export interface DeviceConfig {
  sensorWakeupPeriod: number;   // seconds
  sleepAfterSeconds: number;
  dimAfterSeconds: number;
  noxSamplePeriod: number;
  screenBrightness: number;     // 0-75
  persistFlags: bigint;
}

export const PersistFlag = {
  BATTERY_ALERT:  1n << 0n,
  MANUAL_ORIENT:  1n << 1n,
  USE_FAHRENHEIT: 1n << 2n,
  AQ_FIRST:       1n << 3n,
  PAUSE_CARE:     1n << 4n,
  ETERNAL_WAKE:   1n << 5n,
  PAUSE_LOGGING:  1n << 6n,
} as const;

export const LogCellFlag = {
  HAS_TEMP_RH_PARTICLES: 0x01,
  HAS_CO2: 0x02,
  HAS_COG_PERF: 0x04,
} as const;
