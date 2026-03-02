import { create } from 'zustand';
import { ble } from '../ble/connection.ts';
import {
  readDeviceName, readTime, readPetName, readStats, readDeviceConfig,
  readItemsOwned, readItemsPlaced, readBonus, readCellCount,
} from '../ble/characteristics.ts';
import type { ConnectionState, PetStats, DeviceConfig } from '../types/index.ts';

interface DeviceState {
  connectionState: ConnectionState;
  deviceName: string | null;
  petName: string | null;
  deviceTime: number | null;
  petStats: PetStats | null;
  config: DeviceConfig | null;
  itemsOwned: Uint8Array | null;
  itemsPlaced: Uint8Array | null;
  bonus: number | null;
  cellCount: number | null;
  error: string | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshDeviceInfo: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  // Subscribe to connection state changes (skip if simulation is active)
  ble.onConnectionChange((state) => {
    if (localStorage.getItem('ucrit-simulation-active') === 'true') return;
    set({ connectionState: state });
    if (state === 'connected') {
      get().refreshDeviceInfo();
    }
  });

  return {
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

    connect: async () => {
      try {
        set({ error: null });
        await ble.connect();
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // Don't show error when user cancels the BLE chooser dialog
        if (msg.includes('cancelled') || msg.includes('canceled')) return;
        set({ error: msg });
      }
    },

    disconnect: async () => {
      await ble.disconnect();
      set({
        deviceName: null, petName: null, deviceTime: null,
        petStats: null, config: null, itemsOwned: null,
        itemsPlaced: null, bonus: null, cellCount: null,
      });
    },

    refreshDeviceInfo: async () => {
      try {
        const [deviceName, petName, deviceTime, petStats, config, itemsOwned, itemsPlaced, bonus, cellCount] =
          await Promise.all([
            readDeviceName(), readPetName(), readTime(), readStats(),
            readDeviceConfig(), readItemsOwned(), readItemsPlaced(),
            readBonus(), readCellCount(),
          ]);
        set({ deviceName, petName, deviceTime, petStats, config, itemsOwned, itemsPlaced, bonus, cellCount });
      } catch (err) {
        console.error('Failed to read device info:', err);
      }
    },

    setError: (error) => set({ error }),
  };
});
