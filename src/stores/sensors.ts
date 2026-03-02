import { create } from 'zustand';
import { ble } from '../ble/connection.ts';
import type { SensorValues, SensorReading } from '../types/index.ts';
import { emptySensorValues } from '../ble/parsers.ts';

const MAX_HISTORY = 360; // ~30 minutes at 5s intervals

interface SensorState {
  current: SensorValues;
  history: SensorReading[];
}

export const useSensorStore = create<SensorState>(() => ({
  current: emptySensorValues(),
  history: [],
}));

// Subscribe to BLE sensor updates
ble.onSensorUpdate((partial) => {
  useSensorStore.setState((state) => {
    const current = { ...state.current, ...partial };
    const now = Date.now();

    // Only push to history if we have at least one real value
    const hasValue = Object.values(current).some(v => v !== null);
    if (!hasValue) return { current };

    // Throttle history: only add if >= 4s since last entry
    const lastTs = state.history.length > 0 ? state.history[state.history.length - 1].timestamp : 0;
    if (now - lastTs < 4000) return { current };

    const reading: SensorReading = { ...current, timestamp: now };
    const history = [...state.history, reading].slice(-MAX_HISTORY);
    return { current, history };
  });
});

// Reset sensors on disconnect (skip if simulation is active)
ble.onConnectionChange((state) => {
  if (localStorage.getItem('ucrit-simulation-active') === 'true') return;
  if (state === 'disconnected') {
    useSensorStore.setState({ current: emptySensorValues(), history: [] });
  }
});
