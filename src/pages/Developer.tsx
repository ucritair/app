import { useState, useEffect, useCallback } from 'react';
import { useDeviceStore } from '../stores/device.ts';
import { useLogStore } from '../stores/logs.ts';
import { useSimulationStore } from '../stores/simulation.ts';
import { FIXTURE } from '../data/fixture.ts';
import { ble } from '../ble/connection.ts';
import { readTime, writeTime, readCellData, writeCellSelector, readCellCount, countBitmapItems } from '../ble/characteristics.ts';
import { parseStats, parseConfig, parseLogCell } from '../ble/parsers.ts';
import { fmtDateTime, getLocalTimeAsEpoch } from '../lib/units.ts';
import { Clock, Search, Terminal, Table, Usb, ChevronDown, Download } from 'lucide-react';

// ── Known BLE characteristics for the inspector dropdown ──
type Decoder = (dv: DataView) => string;

interface CharDef {
  uuid: string;
  label: string;
  desc: string;
  access: 'r' | 'w' | 'rw';
  format: string;
  decode?: Decoder;
}

// ── Decoders for known characteristics ──
const decString: Decoder = (dv) => {
  const bytes = new Uint8Array(dv.buffer);
  const end = bytes.indexOf(0);
  return `"${new TextDecoder().decode(bytes.subarray(0, end >= 0 ? end : bytes.length))}"`;
};
const decTime: Decoder = (dv) => {
  const ts = dv.getUint32(0, true);
  return `${ts}  →  ${fmtDateTime(ts)}`;
};
const decUint32: Decoder = (dv) => dv.getUint32(0, true).toString();
const decBonus: Decoder = (dv) => `${dv.getUint32(0, true)} coins`;
const decStats: Decoder = (dv) => {
  const s = parseStats(dv);
  return `vigour=${s.vigour}  focus=${s.focus}  spirit=${s.spirit}  age=${s.age}  interventions=${s.interventions}`;
};
const decConfig: Decoder = (dv) => {
  const c = parseConfig(dv);
  return `wakeup=${c.sensorWakeupPeriod}s  sleep=${c.sleepAfterSeconds}s  dim=${c.dimAfterSeconds}s  nox=${c.noxSamplePeriod}s  brightness=${c.screenBrightness}  flags=0x${c.persistFlags.toString(16)}`;
};
const decBitmap: Decoder = (dv) => {
  const bytes = new Uint8Array(dv.buffer);
  return `${countBitmapItems(bytes)} items set (of ${bytes.length * 8} bits)`;
};
const decCell: Decoder = (dv) => {
  if (dv.byteLength >= 57) {
    const cell = parseLogCell(dv);
    return `cell#${cell.cellNumber}  ${fmtDateTime(cell.timestamp)}  CO₂=${cell.co2}ppm  T=${cell.temperature.toFixed(1)}°C  RH=${cell.humidity.toFixed(1)}%  PM2.5=${cell.pm[1].toFixed(1)}  VOC=${cell.voc}  NOx=${cell.nox}`;
  }
  return `(${dv.byteLength}B — use Cell Inspector for full decode)`;
};
const decEssTemp: Decoder = (dv) => `${(dv.getInt16(0, true) / 100).toFixed(2)} °C`;
const decEssHum: Decoder = (dv) => `${(dv.getUint16(0, true) / 100).toFixed(2)} %`;
const decEssPressure: Decoder = (dv) => `${(dv.getUint32(0, true) / 1000).toFixed(1)} hPa`;
const decEssCO2: Decoder = (dv) => `${dv.getUint16(0, true)} ppm`;
const decEssPM: Decoder = (dv) => {
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  const val = b0 | (b1 << 8);
  const sign = (val >> 15) & 1;
  const exp = (val >> 10) & 0x1f;
  const frac = val & 0x3ff;
  let f: number;
  if (exp === 0) f = (sign ? -1 : 1) * (frac / 1024) * 2 ** -14;
  else if (exp === 31) f = frac ? NaN : (sign ? -Infinity : Infinity);
  else f = (sign ? -1 : 1) * (1 + frac / 1024) * 2 ** (exp - 15);
  return `${f.toFixed(1)} µg/m³`;
};

const CUSTOM_CHARS: CharDef[] = [
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40001', label: 'Device Name', desc: 'UTF-8 string, null-terminated', access: 'rw', format: 'string', decode: decString },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40002', label: 'Time', desc: 'Unix timestamp (local-as-epoch)', access: 'rw', format: 'uint32 LE', decode: decTime },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40003', label: 'Cell Count', desc: 'Last cell index on device', access: 'r', format: 'uint32 LE', decode: decUint32 },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40004', label: 'Cell Selector', desc: 'Write cell index to select; 0xFFFFFFFF = current', access: 'w', format: 'uint32 LE' },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40005', label: 'Cell Data', desc: 'Read selected cell (53 bytes)', access: 'r', format: '53B struct', decode: decCell },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40006', label: 'Log Stream', desc: 'Write start+count to begin streaming', access: 'rw', format: '8B cmd / 57B notif' },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40010', label: 'Pet Stats', desc: 'Happiness, discipline, hunger, etc.', access: 'r', format: 'struct', decode: decStats },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40011', label: 'Items Owned', desc: 'Bitmap of owned items (256 bits)', access: 'r', format: '32 bytes', decode: decBitmap },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40012', label: 'Items Placed', desc: 'Bitmap of placed items (256 bits)', access: 'r', format: '32 bytes', decode: decBitmap },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40013', label: 'Bonus', desc: 'Bonus value (game currency)', access: 'rw', format: 'uint32 LE', decode: decBonus },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40014', label: 'Pet Name', desc: 'UTF-8 string, null-terminated', access: 'rw', format: 'string', decode: decString },
  { uuid: 'fc7d4395-1019-49c4-a91b-7491ecc40015', label: 'Device Config', desc: 'Device configuration struct', access: 'rw', format: 'struct', decode: decConfig },
];

const ESS_CHARS: CharDef[] = [
  { uuid: '00002a6e-0000-1000-8000-00805f9b34fb', label: 'ESS Temperature', desc: 'int16 LE × 0.01 °C', access: 'r', format: 'int16 LE', decode: decEssTemp },
  { uuid: '00002a6f-0000-1000-8000-00805f9b34fb', label: 'ESS Humidity', desc: 'uint16 LE × 0.01 %', access: 'r', format: 'uint16 LE', decode: decEssHum },
  { uuid: '00002a6d-0000-1000-8000-00805f9b34fb', label: 'ESS Pressure', desc: 'uint32 LE × 0.1 Pa', access: 'r', format: 'uint32 LE', decode: decEssPressure },
  { uuid: '00002b8c-0000-1000-8000-00805f9b34fb', label: 'ESS CO₂', desc: 'uint16 LE ppm', access: 'r', format: 'uint16 LE', decode: decEssCO2 },
  { uuid: '00002bd6-0000-1000-8000-00805f9b34fb', label: 'ESS PM2.5', desc: 'uint16 LE × 0.1 µg/m³', access: 'r', format: 'uint16 LE', decode: decEssPM },
  { uuid: '00002bd5-0000-1000-8000-00805f9b34fb', label: 'ESS PM1.0', desc: 'uint16 LE × 0.1 µg/m³', access: 'r', format: 'uint16 LE', decode: decEssPM },
  { uuid: '00002bd7-0000-1000-8000-00805f9b34fb', label: 'ESS PM10', desc: 'uint16 LE × 0.1 µg/m³', access: 'r', format: 'uint16 LE', decode: decEssPM },
];

const ALL_CHARS = [...CUSTOM_CHARS, ...ESS_CHARS];

// ── USB Serial command bytes ──
const CMD_DFU = new Uint8Array([0xCA, 0x7D, 0xF0, 0x01]);
const CMD_WARM_REBOOT = new Uint8Array([0xCA, 0x7D, 0xBE, 0x01]);

export default function Developer() {
  const connectionState = useDeviceStore(s => s.connectionState);
  const { active: simActive, activate, deactivate } = useSimulationStore();

  const showTools = connectionState === 'connected' || simActive;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Developer Tools</h2>

      {/* Simulation toggle — always visible */}
      <SimulationToggle active={simActive} onActivate={activate} onDeactivate={deactivate} />

      {!showTools ? (
        <div className="text-center py-16 text-gray-500">
          Connect to a device to access developer tools.
        </div>
      ) : (
        <>
          {/* BLE tools — only when a real device is connected */}
          {!simActive && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TimeSync />
              <RawBLEInspector />
              <USBSerial />
              <ExportFixture />
            </div>
          )}

          <LogDataTable simActive={simActive} />
        </>
      )}
    </div>
  );
}

// ─────────────────────── SimulationToggle ───────────────────────

function SimulationToggle({ active, onActivate, onDeactivate }: {
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="bg-purple-900/20 border border-purple-800/40 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-purple-300">Simulated Data</h3>
          <p className="text-xs text-gray-400 mt-1">
            Demo mode — explore the app with fixture data, no device required.
          </p>
        </div>
        <div
          onClick={active ? onDeactivate : onActivate}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
            active ? 'bg-purple-600' : 'bg-gray-700'
          }`}
        >
          <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
            active ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────── ExportFixture ───────────────────────

function ExportFixture() {
  const handleExport = () => {
    const device = useDeviceStore.getState();
    const logs = useLogStore.getState();

    const fixture = {
      device: {
        deviceName: device.deviceName ?? 'uCrit',
        petName: device.petName ?? 'Pet',
        deviceTime: device.deviceTime ?? Math.floor(Date.now() / 1000),
        petStats: device.petStats ?? { vigour: 50, focus: 50, spirit: 50, age: 0, interventions: 0 },
        config: device.config ? {
          sensorWakeupPeriod: device.config.sensorWakeupPeriod,
          sleepAfterSeconds: device.config.sleepAfterSeconds,
          dimAfterSeconds: device.config.dimAfterSeconds,
          noxSamplePeriod: device.config.noxSamplePeriod,
          screenBrightness: device.config.screenBrightness,
          persistFlags: Number(device.config.persistFlags),
        } : { sensorWakeupPeriod: 180, sleepAfterSeconds: 60, dimAfterSeconds: 30, noxSamplePeriod: 10, screenBrightness: 50, persistFlags: 0 },
        itemsOwned: device.itemsOwned ? Array.from(device.itemsOwned) : new Array(32).fill(0),
        itemsPlaced: device.itemsPlaced ? Array.from(device.itemsPlaced) : new Array(32).fill(0),
        bonus: device.bonus ?? 0,
        cellCount: device.cellCount ?? 0,
      },
      logCells: logs.cells,
    };

    const json = JSON.stringify(fixture, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ucrit-fixture.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Download className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-medium text-gray-400">Export Fixture</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Download all device data + cached log cells as a JSON fixture file for simulation mode.
      </p>
      <button
        onClick={handleExport}
        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors"
      >
        Export Fixture JSON
      </button>
    </div>
  );
}

// ─────────────────────── TimeSync ───────────────────────

function TimeSync() {
  const [deviceTime, setDeviceTime] = useState<number | null>(null);
  const [customTime, setCustomTime] = useState('');
  const [status, setStatus] = useState('');

  const handleReadTime = async () => {
    const t = await readTime();
    setDeviceTime(t);
    setStatus(`Read: ${t} (${fmtDateTime(t)})`);
  };

  const handleSyncNow = async () => {
    const now = getLocalTimeAsEpoch();
    await writeTime(now);
    setStatus(`Set to ${fmtDateTime(now)}`);
    handleReadTime();
  };

  const handleSetCustom = async () => {
    const ts = parseInt(customTime);
    if (isNaN(ts)) { setStatus('Invalid timestamp'); return; }
    await writeTime(ts);
    setStatus(`Set to ${ts} (${fmtDateTime(ts)})`);
    handleReadTime();
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-medium text-gray-400">Time Sync</h3>
      </div>

      <div className="space-y-3">
        {deviceTime != null && (
          <div className="text-sm">
            <span className="text-gray-500">Device: </span>
            <span className="font-mono">{deviceTime}</span>
            <span className="text-gray-500 ml-2">({fmtDateTime(deviceTime)})</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={handleReadTime} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors">
            Read Time
          </button>
          <button onClick={handleSyncNow} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors">
            Sync to Host
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Unix timestamp"
            value={customTime}
            onChange={e => setCustomTime(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm flex-1 font-mono"
          />
          <button onClick={handleSetCustom} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
            Set
          </button>
        </div>

        {status && <p className="text-xs text-gray-500 font-mono">{status}</p>}
      </div>
    </div>
  );
}

// CellInspector removed — merged into LogDataTable below

// ─────────────────────── RawBLEInspector ───────────────────────

function RawBLEInspector() {
  const [selectedIdx, setSelectedIdx] = useState(-1); // -1 = custom
  const [customUuid, setCustomUuid] = useState('');
  const [hexData, setHexData] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [writeHex, setWriteHex] = useState('');
  const [status, setStatus] = useState('');

  const activeUuid = selectedIdx >= 0 ? ALL_CHARS[selectedIdx].uuid : customUuid.trim();
  const activeDef = selectedIdx >= 0 ? ALL_CHARS[selectedIdx] : null;

  const handleRead = async () => {
    if (!activeUuid) return;
    try {
      const dv = await ble.readCharacteristic(activeUuid);
      const bytes = new Uint8Array(dv.buffer);
      setHexData(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
      setStatus(`Read ${bytes.length} bytes`);
      // Try to decode if we have a decoder for this characteristic
      if (activeDef?.decode) {
        try { setDecoded(activeDef.decode(dv)); } catch { setDecoded(null); }
      } else {
        setDecoded(null);
      }
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
      setHexData(null);
      setDecoded(null);
    }
  };

  const handleWrite = async () => {
    if (!activeUuid || !writeHex.trim()) return;
    try {
      const bytes = writeHex.trim().split(/\s+/).map(h => parseInt(h, 16));
      const buf = new Uint8Array(bytes).buffer;
      await ble.writeCharacteristic(activeUuid, buf);
      setStatus(`Wrote ${bytes.length} bytes`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Terminal className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-medium text-gray-400">Raw BLE Inspector</h3>
      </div>

      <div className="space-y-3">
        {/* Characteristic dropdown */}
        <div className="relative">
          <select
            value={selectedIdx}
            onChange={e => setSelectedIdx(parseInt(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full appearance-none pr-8"
          >
            <option value={-1}>Custom UUID...</option>
            <optgroup label="Custom Service">
              {CUSTOM_CHARS.map((c, i) => (
                <option key={c.uuid} value={i}>
                  {c.label} ({c.access}) — {c.format}
                </option>
              ))}
            </optgroup>
            <optgroup label="Environmental Sensing (ESS)">
              {ESS_CHARS.map((c, i) => (
                <option key={c.uuid} value={CUSTOM_CHARS.length + i}>
                  {c.label} ({c.access}) — {c.format}
                </option>
              ))}
            </optgroup>
          </select>
          <ChevronDown className="w-4 h-4 text-gray-500 absolute right-2 top-2.5 pointer-events-none" />
        </div>

        {/* Custom UUID input (when Custom selected) */}
        {selectedIdx < 0 && (
          <input
            type="text"
            placeholder="Characteristic UUID"
            value={customUuid}
            onChange={e => setCustomUuid(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-full font-mono text-xs"
          />
        )}

        {/* Info about selected characteristic */}
        {activeDef && (
          <div className="bg-gray-950 border border-gray-800 rounded p-2">
            <p className="text-xs text-gray-400">{activeDef.desc}</p>
            <p className="text-[10px] text-gray-600 font-mono mt-0.5">{activeDef.uuid}</p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleRead}
            disabled={!activeUuid || activeDef?.access === 'w'}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded text-sm transition-colors"
          >
            Read
          </button>
        </div>

        {hexData && (
          <div className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-green-400 break-all whitespace-pre-wrap overflow-hidden">
            {hexData}
          </div>
        )}

        {decoded && (
          <div className="bg-blue-950/30 border border-blue-900/50 rounded p-2.5 text-xs font-mono text-blue-300 break-all">
            {decoded}
          </div>
        )}

        <input
          type="text"
          placeholder="Hex bytes to write (e.g., CA 7D F0 01)"
          value={writeHex}
          onChange={e => setWriteHex(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-full font-mono text-xs"
        />
        <button
          onClick={handleWrite}
          disabled={!activeUuid || activeDef?.access === 'r'}
          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-800 disabled:text-gray-600 rounded text-sm transition-colors"
        >
          Write
        </button>

        {status && <p className="text-xs text-gray-500 font-mono">{status}</p>}
      </div>
    </div>
  );
}

// ─────────────────────── USBSerial ───────────────────────

function USBSerial() {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const hasSerial = 'serial' in navigator;

  const connect = useCallback(async () => {
    if (!hasSerial) return;
    try {
      const p = await navigator.serial.requestPort();
      await p.open({ baudRate: 115200 });
      setPort(p);
      setStatus('Connected');
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }, [hasSerial]);

  const disconnect = useCallback(async () => {
    if (!port) return;
    try {
      await port.close();
    } catch {
      // already closed
    }
    setPort(null);
    setStatus('Disconnected');
  }, [port]);

  const sendCommand = useCallback(async (cmd: Uint8Array, label: string) => {
    if (!port?.writable) {
      setStatus('Not connected');
      return;
    }
    setBusy(true);
    try {
      const writer = port.writable.getWriter();
      await writer.write(cmd);
      writer.releaseLock();
      setStatus(`Sent: ${label}`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
    setBusy(false);
  }, [port]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Usb className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-medium text-gray-400">USB Serial</h3>
      </div>

      {!hasSerial ? (
        <p className="text-xs text-gray-500">WebSerial not supported in this browser. Use Chrome or Edge.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            {!port ? (
              <button onClick={connect} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors">
                Connect USB
              </button>
            ) : (
              <button onClick={disconnect} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
                Disconnect
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">Enter DFU</p>
                <p className="text-[10px] text-gray-600 font-mono">CA 7D F0 01</p>
              </div>
              <button
                onClick={() => sendCommand(CMD_DFU, 'Enter DFU')}
                disabled={!port || busy}
                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-800 disabled:text-gray-600 rounded text-sm transition-colors"
              >
                Send
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">Warm Reboot</p>
                <p className="text-[10px] text-gray-600 font-mono">CA 7D BE 01</p>
              </div>
              <button
                onClick={() => sendCommand(CMD_WARM_REBOOT, 'Warm Reboot')}
                disabled={!port || busy}
                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-800 disabled:text-gray-600 rounded text-sm transition-colors"
              >
                Send
              </button>
            </div>
          </div>

          {status && <p className="text-xs text-gray-500 font-mono">{status}</p>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── LogDataTable (with integrated Cell Inspector) ───────────────────────

function LogDataTable({ simActive }: { simActive: boolean }) {
  const { cells, loadCachedCells } = useLogStore();

  // Cell inspector state
  const [cellNr, setCellNr] = useState('');
  const [cellData, setCellData] = useState<string | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [deviceCellRange, setDeviceCellRange] = useState<string | null>(null);

  useEffect(() => {
    if (!simActive) loadCachedCells();
  }, [loadCachedCells, simActive]);

  // Pre-populate with latest cached cell number
  useEffect(() => {
    if (cells.length > 0 && cellNr === '') {
      setCellNr(String(cells[cells.length - 1].cellNumber));
    }
  }, [cells]);

  // Fetch device cell range info (skip in sim mode)
  useEffect(() => {
    if (simActive) {
      if (FIXTURE.logCells.length > 0) {
        const first = FIXTURE.logCells[0];
        const last = FIXTURE.logCells[FIXTURE.logCells.length - 1];
        setDeviceCellRange(
          `Fixture: ${first.cellNumber}\u2013${last.cellNumber} \u00B7 ${fmtDateTime(first.timestamp)} \u2192 ${fmtDateTime(last.timestamp)}`
        );
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const count = await readCellCount();
        if (cancelled) return;
        await writeCellSelector(0);
        const firstCell = await readCellData();
        await writeCellSelector(count);
        const lastCell = await readCellData();
        if (cancelled) return;
        setDeviceCellRange(
          `Device: 0\u2013${count} \u00B7 ${fmtDateTime(firstCell.timestamp)} \u2192 ${fmtDateTime(lastCell.timestamp)}`
        );
      } catch {
        // Fail silently — range info is optional
      }
    })();
    return () => { cancelled = true; };
  }, [simActive]);

  const handleInspect = async () => {
    const nr = parseInt(cellNr);
    if (isNaN(nr)) return;
    setInspectLoading(true);

    if (simActive) {
      // Look up from fixture data
      const cell = FIXTURE.logCells.find(c => c.cellNumber === nr);
      setCellData(cell
        ? JSON.stringify(cell, null, 2)
        : `Cell #${nr} not found in fixture data`
      );
    } else {
      try {
        await writeCellSelector(nr);
        const cell = await readCellData();
        setCellData(JSON.stringify(cell, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
      } catch (err) {
        setCellData(`Error: ${(err as Error).message}`);
      }
    }
    setInspectLoading(false);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
        <Table className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-medium text-gray-400">Log Cell Data</h3>
        <span className="text-xs text-gray-500 ml-auto">{cells.length} cells cached</span>
      </div>

      {/* Cell Inspector — compact inline row */}
      <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-900/80">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="text-xs text-gray-500 shrink-0">Inspect cell</span>
          <input
            type="number"
            placeholder="#"
            value={cellNr}
            onChange={e => setCellNr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInspect()}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-20 font-mono"
          />
          <button
            onClick={handleInspect}
            disabled={inspectLoading}
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded text-xs transition-colors shrink-0"
          >
            {inspectLoading ? '...' : 'Read'}
          </button>
          {deviceCellRange && (
            <span className="text-[10px] text-gray-500 font-mono ml-auto truncate hidden sm:inline">
              {deviceCellRange}
            </span>
          )}
        </div>
        {cellData && (
          <pre className="bg-gray-950 border border-gray-800 rounded p-2.5 text-xs font-mono text-gray-300 overflow-auto max-h-48 mt-2">
            {cellData}
          </pre>
        )}
      </div>

      {/* Table */}
      {cells.length > 0 && (
        <>
          <div className="overflow-x-auto overflow-y-auto max-h-96">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">CO2</th>
                  <th className="px-4 py-3">PM2.5</th>
                  <th className="px-4 py-3">Temp</th>
                  <th className="px-4 py-3">RH</th>
                  <th className="px-4 py-3">VOC</th>
                  <th className="px-4 py-3">NOx</th>
                  <th className="px-4 py-3">Pressure</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(-100).reverse().map(c => (
                  <tr key={c.cellNumber} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-2 text-gray-500 tabular-nums">{c.cellNumber}</td>
                    <td className="px-4 py-2 text-gray-300 tabular-nums">{fmtDateTime(c.timestamp)}</td>
                    <td className="px-4 py-2 tabular-nums">{c.co2} ppm</td>
                    <td className="px-4 py-2 tabular-nums">{c.pm[1].toFixed(1)}</td>
                    <td className="px-4 py-2 tabular-nums">{c.temperature.toFixed(1)} °C</td>
                    <td className="px-4 py-2 tabular-nums">{c.humidity.toFixed(1)}%</td>
                    <td className="px-4 py-2 tabular-nums">{c.voc}</td>
                    <td className="px-4 py-2 tabular-nums">{c.nox}</td>
                    <td className="px-4 py-2 tabular-nums">{c.pressure.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cells.length > 100 && (
            <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-800">
              Showing latest 100 of {cells.length} cells
            </div>
          )}
        </>
      )}
    </div>
  );
}
