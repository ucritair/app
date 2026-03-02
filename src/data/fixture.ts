/**
 * Fixture data for simulation / demo mode.
 *
 * Real device data is captured by:
 *   python3 scripts/capture_fixture.py -o webapp/src/data/fixture_data.json
 *
 * The JSON file is imported statically. Replace it with real captured data
 * to get authentic sensor readings in demo mode.
 *
 * persistFlags is stored as a number (fits in Number for current flags)
 * and converted to bigint on load by the simulation store.
 */

import type { LogCell, PetStats } from '../types/index.ts';
import fixtureJson from './fixture_data.json';

export interface FixtureDevice {
  deviceName: string;
  petName: string;
  deviceTime: number;
  petStats: PetStats;
  config: {
    sensorWakeupPeriod: number;
    sleepAfterSeconds: number;
    dimAfterSeconds: number;
    noxSamplePeriod: number;
    screenBrightness: number;
    persistFlags: number;        // stored as Number, converted to bigint on load
  };
  itemsOwned: number[];          // Uint8Array serialized as plain array
  itemsPlaced: number[];
  bonus: number;
  cellCount: number;
}

export interface FixtureData {
  device: FixtureDevice;
  logCells: LogCell[];
}

export const FIXTURE: FixtureData = fixtureJson as unknown as FixtureData;
