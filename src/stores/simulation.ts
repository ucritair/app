/**
 * Simulation mode store.
 *
 * When active, populates device / sensor / log stores with fixture data
 * and cycles through recent log cells to simulate live sensor updates.
 */

import { create } from 'zustand';
import { FIXTURE } from '../data/fixture.ts';
import { useSensorStore } from './sensors.ts';
import { useDeviceStore } from './device.ts';
import { useLogStore } from './logs.ts';
import type { SensorValues } from '../types/index.ts';

export const SIM_STORAGE_KEY = 'ucrit-simulation-active';

interface SimulationState {
  active: boolean;
  activate: () => void;
  deactivate: () => void;
}

let liveTimer: ReturnType<typeof setInterval> | null = null;
let cellIndex = 0;

/* ── helpers ── */

function jitter(v: number | null, pct = 0.04): number | null {
  if (v === null || v === 0) return v;
  return v * (1 + (Math.random() - 0.5) * pct);
}

function pushSensorUpdate(cell: (typeof FIXTURE.logCells)[0]) {
  const values: SensorValues = {
    temperature: jitter(cell.temperature),
    humidity: jitter(cell.humidity),
    co2: Math.round(jitter(cell.co2) ?? 0),
    pm1_0: jitter(cell.pm[0]),
    pm2_5: jitter(cell.pm[1]),
    pm4_0: jitter(cell.pm[2]),
    pm10: jitter(cell.pm[3]),
    pressure: jitter(cell.pressure),
    voc: Math.round(jitter(cell.voc) ?? 0),
    nox: Math.round(jitter(cell.nox) ?? 0),
  };

  useSensorStore.setState((state) => {
    const current = { ...values };
    const now = Date.now();
    const lastTs = state.history.length > 0
      ? state.history[state.history.length - 1].timestamp
      : 0;
    if (now - lastTs < 4000) return { current };
    const reading = { ...current, timestamp: now };
    const history = [...state.history, reading].slice(-360);
    return { current, history };
  });
}

function startLiveUpdates() {
  const cells = FIXTURE.logCells;
  if (cells.length === 0) return;

  // Use last 60 cells (or fewer) as cycling source
  const recentCells = cells.slice(-60);
  cellIndex = 0;

  // Push initial reading immediately
  pushSensorUpdate(recentCells[cellIndex]);

  liveTimer = setInterval(() => {
    cellIndex = (cellIndex + 1) % recentCells.length;
    pushSensorUpdate(recentCells[cellIndex]);
  }, 5000);
}

function stopLiveUpdates() {
  if (liveTimer !== null) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

function populateStores() {
  const d = FIXTURE.device;

  useDeviceStore.setState({
    connectionState: 'connected',
    deviceName: d.deviceName,
    petName: d.petName,
    deviceTime: d.deviceTime,
    petStats: d.petStats,
    config: {
      ...d.config,
      persistFlags: BigInt(d.config.persistFlags),
    },
    itemsOwned: new Uint8Array(d.itemsOwned),
    itemsPlaced: new Uint8Array(d.itemsPlaced),
    bonus: d.bonus,
    cellCount: FIXTURE.logCells.length > 0
      ? FIXTURE.logCells[FIXTURE.logCells.length - 1].cellNumber
      : 0,
    error: null,
  });

  useLogStore.setState({
    cells: FIXTURE.logCells,
    cachedCount: FIXTURE.logCells.length,
    isStreaming: false,
    streamProgress: null,
    error: null,
  });

  startLiveUpdates();
}

function clearStores() {
  stopLiveUpdates();

  useDeviceStore.setState({
    connectionState: 'disconnected',
    deviceName: null,
    petName: null,
    deviceTime: null,
    petStats: null,
    config: null,
    itemsOwned: null,
    itemsPlaced: null,
    bonus: null,
    cellCount: null,
    error: null,
  });

  useSensorStore.setState({
    current: {
      temperature: null, humidity: null, co2: null,
      pm1_0: null, pm2_5: null, pm4_0: null, pm10: null,
      pressure: null, voc: null, nox: null,
    },
    history: [],
  });

  // Reload real cached data from IndexedDB
  useLogStore.getState().loadCachedCells();
}

/* ── store ── */

export const useSimulationStore = create<SimulationState>((set) => ({
  active: localStorage.getItem(SIM_STORAGE_KEY) === 'true',

  activate: () => {
    localStorage.setItem(SIM_STORAGE_KEY, 'true');
    set({ active: true });
    populateStores();
  },

  deactivate: () => {
    localStorage.removeItem(SIM_STORAGE_KEY);
    set({ active: false });
    clearStores();
  },
}));

// Auto-activate on app load if persisted
if (localStorage.getItem(SIM_STORAGE_KEY) === 'true') {
  setTimeout(() => populateStores(), 0);
}
