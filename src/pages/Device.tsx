import { useState } from 'react';
import { useDeviceStore } from '../stores/device.ts';
import {
  writeDeviceName, writePetName, writeTime, writeDeviceConfig,
  countBitmapItems,
} from '../ble/characteristics.ts';
import { fmtDateTime, getLocalTimeAsEpoch } from '../lib/units.ts';
import { PersistFlag } from '../types/index.ts';
import type { DeviceConfig } from '../types/index.ts';
import { Save, Clock, RefreshCw } from 'lucide-react';
import { useSimulationStore } from '../stores/simulation.ts';

export default function Device() {
  const {
    connectionState, deviceName, petName, deviceTime, petStats,
    config, itemsOwned, itemsPlaced, bonus, cellCount, refreshDeviceInfo,
  } = useDeviceStore();
  const simActive = useSimulationStore(s => s.active);

  if (connectionState !== 'connected') {
    return (
      <div className="text-center py-16 text-gray-500">
        Connect to a device to view its settings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Device Settings</h2>
        {!simActive && (
          <button
            onClick={refreshDeviceInfo}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device info */}
        <InfoSection
          deviceName={deviceName}
          petName={petName}
          deviceTime={deviceTime}
          bonus={bonus}
          cellCount={cellCount}
          itemsOwned={itemsOwned}
          itemsPlaced={itemsPlaced}
          readOnly={simActive}
        />

        {/* Pet stats */}
        {petStats && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-medium text-gray-400 mb-4">Pet Stats</h3>
            <div className="grid grid-cols-2 gap-4">
              <StatBar label="Vigour" value={petStats.vigour} max={100} color="#22c55e" />
              <StatBar label="Focus" value={petStats.focus} max={100} color="#3b82f6" />
              <StatBar label="Spirit" value={petStats.spirit} max={100} color="#a855f7" />
              <div>
                <span className="text-xs text-gray-500">Age</span>
                <p className="text-lg font-bold">{petStats.age}</p>
              </div>
            </div>
          </div>
        )}

        {/* Config editor */}
        {config && <ConfigEditor config={config} readOnly={simActive} />}
      </div>
    </div>
  );
}

function InfoSection({
  deviceName, petName, deviceTime, bonus, cellCount, itemsOwned, itemsPlaced, readOnly = false,
}: {
  deviceName: string | null;
  petName: string | null;
  deviceTime: number | null;
  bonus: number | null;
  cellCount: number | null;
  itemsOwned: Uint8Array | null;
  itemsPlaced: Uint8Array | null;
  readOnly?: boolean;
}) {
  const [editName, setEditName] = useState('');
  const [editPetName, setEditPetName] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);

  const handleSaveName = async () => {
    if (editName.trim()) {
      await writeDeviceName(editName.trim());
      useDeviceStore.getState().refreshDeviceInfo();
      setEditingField(null);
    }
  };

  const handleSavePetName = async () => {
    if (editPetName.trim()) {
      await writePetName(editPetName.trim());
      useDeviceStore.getState().refreshDeviceInfo();
      setEditingField(null);
    }
  };

  const handleSyncTime = async () => {
    const now = getLocalTimeAsEpoch();
    await writeTime(now);
    useDeviceStore.getState().refreshDeviceInfo();
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-medium text-gray-400">Device Info</h3>

      <InfoRow label="Device Name" value={deviceName ?? '--'}>
        {!readOnly && (editingField === 'name' ? (
          <div className="flex gap-2">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-32"
              autoFocus
            />
            <button onClick={handleSaveName} className="text-blue-400 text-sm">Save</button>
            <button onClick={() => setEditingField(null)} className="text-gray-500 text-sm">Cancel</button>
          </div>
        ) : (
          <button onClick={() => { setEditName(deviceName ?? ''); setEditingField('name'); }} className="text-blue-400 text-xs">Edit</button>
        ))}
      </InfoRow>

      <InfoRow label="Pet Name" value={petName ?? '--'}>
        {!readOnly && (editingField === 'pet' ? (
          <div className="flex gap-2">
            <input
              value={editPetName}
              onChange={e => setEditPetName(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm w-32"
              autoFocus
            />
            <button onClick={handleSavePetName} className="text-blue-400 text-sm">Save</button>
            <button onClick={() => setEditingField(null)} className="text-gray-500 text-sm">Cancel</button>
          </div>
        ) : (
          <button onClick={() => { setEditPetName(petName ?? ''); setEditingField('pet'); }} className="text-blue-400 text-xs">Edit</button>
        ))}
      </InfoRow>

      <InfoRow label="Device Time" value={deviceTime ? fmtDateTime(deviceTime) : '--'}>
        {!readOnly && (
          <button onClick={handleSyncTime} className="flex items-center gap-1 text-blue-400 text-xs">
            <Clock className="w-3 h-3" />
            Sync
          </button>
        )}
      </InfoRow>

      <InfoRow label="Log Cells" value={cellCount?.toLocaleString() ?? '--'} />
      <InfoRow label="Bonus" value={bonus?.toString() ?? '--'} />
      <InfoRow label="Items Owned" value={itemsOwned ? countBitmapItems(itemsOwned).toString() : '--'} />
      <InfoRow label="Items Placed" value={itemsPlaced ? countBitmapItems(itemsPlaced).toString() : '--'} />
    </div>
  );
}

function InfoRow({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium tabular-nums">{value}</span>
        {children}
      </div>
    </div>
  );
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-xs font-medium">{value}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ConfigEditor({ config, readOnly = false }: { config: DeviceConfig; readOnly?: boolean }) {
  const [draft, setDraft] = useState<DeviceConfig>(config);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await writeDeviceConfig(draft);
      useDeviceStore.getState().refreshDeviceInfo();
    } catch (err) {
      console.error('Failed to write config:', err);
    }
    setSaving(false);
  };

  const toggleFlag = (flag: bigint) => {
    setDraft(prev => ({
      ...prev,
      persistFlags: prev.persistFlags & flag ? prev.persistFlags & ~flag : prev.persistFlags | flag,
    }));
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-medium text-gray-400 mb-4">Configuration</h3>
      <div className="space-y-4">
        <NumberField label="Sensor Period (s)" value={draft.sensorWakeupPeriod} onChange={v => setDraft(d => ({ ...d, sensorWakeupPeriod: v }))} />
        <NumberField label="Sleep After (s)" value={draft.sleepAfterSeconds} onChange={v => setDraft(d => ({ ...d, sleepAfterSeconds: v }))} />
        <NumberField label="Dim After (s)" value={draft.dimAfterSeconds} onChange={v => setDraft(d => ({ ...d, dimAfterSeconds: v }))} />
        <NumberField label="NOx Period" value={draft.noxSamplePeriod} onChange={v => setDraft(d => ({ ...d, noxSamplePeriod: v }))} />
        <NumberField label="Brightness (0-75)" value={draft.screenBrightness} onChange={v => setDraft(d => ({ ...d, screenBrightness: Math.min(75, Math.max(0, v)) }))} />

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Flags</p>
          <FlagToggle label="Use Fahrenheit" checked={!!(draft.persistFlags & PersistFlag.USE_FAHRENHEIT)} onChange={() => toggleFlag(PersistFlag.USE_FAHRENHEIT)} />
          <FlagToggle label="AQ Dashboard First" checked={!!(draft.persistFlags & PersistFlag.AQ_FIRST)} onChange={() => toggleFlag(PersistFlag.AQ_FIRST)} />
          <FlagToggle label="Eternal Wake" checked={!!(draft.persistFlags & PersistFlag.ETERNAL_WAKE)} onChange={() => toggleFlag(PersistFlag.ETERNAL_WAKE)} />
          <FlagToggle label="Pause Logging" checked={!!(draft.persistFlags & PersistFlag.PAUSE_LOGGING)} onChange={() => toggleFlag(PersistFlag.PAUSE_LOGGING)} />
          <FlagToggle label="Pause Care" checked={!!(draft.persistFlags & PersistFlag.PAUSE_CARE)} onChange={() => toggleFlag(PersistFlag.PAUSE_CARE)} />
          <FlagToggle label="Battery Alert" checked={!!(draft.persistFlags & PersistFlag.BATTERY_ALERT)} onChange={() => toggleFlag(PersistFlag.BATTERY_ALERT)} />
        </div>

        {!readOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg text-sm font-medium transition-colors w-full justify-center"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        )}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-24 text-right tabular-nums"
      />
    </div>
  );
}

function FlagToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-gray-400">{label}</span>
      <div
        onClick={onChange}
        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${checked ? 'bg-blue-600' : 'bg-gray-700'}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
    </label>
  );
}
