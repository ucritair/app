import {
  CUSTOM_SERVICE_UUID, DEVICE_NAME_PREFIX, ESS_SERVICE_UUID,
  ESS_TEMPERATURE, ESS_HUMIDITY, ESS_CO2, ESS_PM2_5, ESS_PRESSURE, ESS_PM1_0, ESS_PM10,
  CHAR_CELL_SELECTOR, CHAR_CELL_DATA,
} from './constants.ts';
import { parseTemperature, parseHumidity, parseCO2, parsePM, parsePressure, parseLogCell } from './parsers.ts';
import type { ConnectionState, SensorValues } from '../types/index.ts';

export type ConnectionListener = (state: ConnectionState) => void;
export type SensorListener = (values: Partial<SensorValues>) => void;

class BleConnection {
  device: BluetoothDevice | null = null;
  server: BluetoothRemoteGATTServer | null = null;
  customService: BluetoothRemoteGATTService | null = null;
  essService: BluetoothRemoteGATTService | null = null;
  state: ConnectionState = 'disconnected';

  private connectionListeners: ConnectionListener[] = [];
  private sensorListeners: SensorListener[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 2;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  onConnectionChange(listener: ConnectionListener) {
    this.connectionListeners.push(listener);
    return () => {
      this.connectionListeners = this.connectionListeners.filter(l => l !== listener);
    };
  }

  onSensorUpdate(listener: SensorListener) {
    this.sensorListeners.push(listener);
    return () => {
      this.sensorListeners = this.sensorListeners.filter(l => l !== listener);
    };
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.connectionListeners.forEach(l => l(state));
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge.');
    }

    this.setState('connecting');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [CUSTOM_SERVICE_UUID] },
          { namePrefix: DEVICE_NAME_PREFIX },
        ],
        optionalServices: [CUSTOM_SERVICE_UUID, ESS_SERVICE_UUID],
      });

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());

      await this.connectToServer();
      this.reconnectAttempts = 0;
      this.setState('connected');
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  private async connectToServer(timeoutMs = 10000): Promise<void> {
    if (!this.device?.gatt) throw new Error('No GATT server');

    // device.gatt.connect() can hang indefinitely if the device isn't
    // advertising yet (e.g. mid-reboot), so we race it against a timeout.
    this.server = await Promise.race([
      this.device.gatt.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connect timeout')), timeoutMs)
      ),
    ]);
    this.customService = await this.server.getPrimaryService(CUSTOM_SERVICE_UUID);

    try {
      this.essService = await this.server.getPrimaryService(ESS_SERVICE_UUID);
      await this.subscribeToESS();
    } catch {
      console.warn('ESS service not available');
    }

    // Start polling current cell for VOC/NOx (not available via ESS)
    this.startCurrentCellPolling();
  }

  private async subscribeToESS(): Promise<void> {
    if (!this.essService) return;

    const subscribe = async (uuid: string, handler: (dv: DataView) => Partial<SensorValues>) => {
      try {
        const char = await this.essService!.getCharacteristic(uuid);
        await char.startNotifications();
        char.addEventListener('characteristicvaluechanged', (e) => {
          const target = e.target as BluetoothRemoteGATTCharacteristic;
          if (target.value) {
            const values = handler(target.value);
            this.sensorListeners.forEach(l => l(values));
          }
        });
      } catch {
        console.warn(`Could not subscribe to ${uuid}`);
      }
    };

    await subscribe(ESS_TEMPERATURE, dv => ({ temperature: parseTemperature(dv) }));
    await subscribe(ESS_HUMIDITY, dv => ({ humidity: parseHumidity(dv) }));
    await subscribe(ESS_CO2, dv => ({ co2: parseCO2(dv) }));
    await subscribe(ESS_PM2_5, dv => ({ pm2_5: parsePM(dv) }));

    // Non-notify reads for pressure, PM1.0, PM10
    try {
      const pressureChar = await this.essService.getCharacteristic(ESS_PRESSURE);
      const pv = await pressureChar.readValue();
      this.sensorListeners.forEach(l => l({ pressure: parsePressure(pv) }));
    } catch { /* ok */ }

    try {
      const pm1Char = await this.essService.getCharacteristic(ESS_PM1_0);
      const p1v = await pm1Char.readValue();
      this.sensorListeners.forEach(l => l({ pm1_0: parsePM(p1v) }));
    } catch { /* ok */ }

    try {
      const pm10Char = await this.essService.getCharacteristic(ESS_PM10);
      const p10v = await pm10Char.readValue();
      this.sensorListeners.forEach(l => l({ pm10: parsePM(p10v) }));
    } catch { /* ok */ }
  }

  /** Poll the "current cell" via custom service to get live VOC/NOx/PM4.0 values.
   *  These sensors are NOT exposed via ESS characteristics — only via log cell data.
   *  Writing 0xFFFFFFFF to the cell selector selects the live/current cell. */
  private startCurrentCellPolling(): void {
    this.stopCurrentCellPolling();

    // Do an initial poll immediately
    this.pollCurrentCell();

    // Then poll every 5 seconds (matches ESS notification rate)
    this.pollTimer = setInterval(() => this.pollCurrentCell(), 5000);
  }

  private stopCurrentCellPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollCurrentCell(): Promise<void> {
    if (!this.customService) return;

    try {
      // Write 0xFFFFFFFF to cell selector to select the "current" (live) cell
      const selectorChar = await this.customService.getCharacteristic(CHAR_CELL_SELECTOR);
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, 0xFFFFFFFF, true);
      await selectorChar.writeValue(buf);

      // Read the current cell data
      const dataChar = await this.customService.getCharacteristic(CHAR_CELL_DATA);
      const dv = await dataChar.readValue();
      const cell = parseLogCell(dv);

      // Extract VOC, NOx, and PM4.0 (sensors not available via ESS)
      const values: Partial<SensorValues> = {};
      if (cell.voc > 0) values.voc = cell.voc;
      if (cell.nox > 0) values.nox = cell.nox;
      values.pm4_0 = cell.pm[2]; // PM4.0

      if (Object.keys(values).length > 0) {
        this.sensorListeners.forEach(l => l(values));
      }
    } catch (err) {
      console.warn('Current cell poll failed:', err);
    }
  }

  private async handleDisconnect(): Promise<void> {
    this.stopCurrentCellPolling();
    this.server = null;
    this.customService = null;
    this.essService = null;

    if (this.reconnectAttempts < this.maxReconnectAttempts && this.device?.gatt) {
      this.setState('reconnecting');
      this.reconnectAttempts++;
      console.log(`[BLE] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);

      await new Promise(r => setTimeout(r, 3000));

      try {
        await this.connectToServer(5000);
        console.log('[BLE] Reconnected successfully');
        this.reconnectAttempts = 0;
        this.setState('connected');
      } catch (err) {
        console.warn(`[BLE] Reconnect attempt ${this.reconnectAttempts} failed:`, (err as Error).message);
        await this.handleDisconnect();
      }
    } else {
      console.log('[BLE] Reconnection gave up — use Connect button to re-pair');
      this.setState('disconnected');
    }
  }

  async disconnect(): Promise<void> {
    this.stopCurrentCellPolling();
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent auto-reconnect
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.server = null;
    this.customService = null;
    this.essService = null;
    this.setState('disconnected');
  }

  async readCharacteristic(uuid: string): Promise<DataView> {
    if (!this.customService) throw new Error('Not connected');
    const char = await this.customService.getCharacteristic(uuid);
    return char.readValue();
  }

  async writeCharacteristic(uuid: string, data: ArrayBuffer): Promise<void> {
    if (!this.customService) throw new Error('Not connected');
    const char = await this.customService.getCharacteristic(uuid);
    await char.writeValue(data);
  }

  async readESSCharacteristic(uuid: string): Promise<DataView> {
    if (!this.essService) throw new Error('ESS service not available');
    const char = await this.essService.getCharacteristic(uuid);
    return char.readValue();
  }
}

// Singleton
export const ble = new BleConnection();
