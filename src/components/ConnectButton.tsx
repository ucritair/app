import { useDeviceStore } from '../stores/device.ts';
import { useSimulationStore } from '../stores/simulation.ts';
import { Bluetooth, BluetoothOff, Loader2, Radio } from 'lucide-react';

export default function ConnectButton() {
  const { connectionState, connect, disconnect } = useDeviceStore();
  const simActive = useSimulationStore(s => s.active);

  if (simActive) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-purple-600/80 text-purple-100 cursor-default"
      >
        <Radio className="w-4 h-4" />
        Simulated
      </button>
    );
  }

  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const isConnected = connectionState === 'connected';

  return (
    <button
      onClick={isConnected ? disconnect : connect}
      disabled={isConnecting}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
        isConnected
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : isConnecting
            ? 'bg-gray-600 text-gray-300 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
      }`}
    >
      {isConnecting ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isConnected ? (
        <Bluetooth className="w-4 h-4" />
      ) : (
        <BluetoothOff className="w-4 h-4" />
      )}
      {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Connect'}
    </button>
  );
}
