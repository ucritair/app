import { useSensorStore } from '../stores/sensors.ts';
import { sensorStatus } from '../lib/aqi.ts';

interface SensorCardProps {
  label: string;
  value: string;
  unit: string;
  score: number | null;
  sensorKey: string;
}

export default function SensorCard({ label, value, unit, score, sensorKey }: SensorCardProps) {
  const history = useSensorStore(s => s.history);
  const status = score != null ? sensorStatus(score) : null;

  // Extract sparkline data for this sensor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sparkData = history
    .map(r => (r as any)[sensorKey] as number | null)
    .filter((v): v is number => v != null);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        {status && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: status.color + '20', color: status.color }}
          >
            {status.label}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      {/* Sparkline */}
      {sparkData.length > 1 && (
        <Sparkline data={sparkData} color={status?.color ?? '#6b7280'} />
      )}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 200;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
