import { useNavigate } from 'react-router-dom';
import { useSensorStore } from '../stores/sensors.ts';
import { useDeviceStore } from '../stores/device.ts';
import AQScore from '../components/AQScore.tsx';
import {
  scoreCO2, scorePM25, scoreNOx, scoreVOC, scoreTemperature, scoreHumidity,
  sensorStatus, sensorBadnessToGrade,
} from '../lib/aqi.ts';
import { fmtTemp, fmtHumidity, fmtCO2, fmtPM, fmtPressure, fmtIndex } from '../lib/units.ts';
import { ChevronRight } from 'lucide-react';

interface SensorItem {
  key: string;
  label: string;
  value: string;
  unit: string;
  score: number | null;  // badness 0-5, null if no scoring curve
}

export default function Dashboard() {
  const current = useSensorStore(s => s.current);
  const connectionState = useDeviceStore(s => s.connectionState);
  const navigate = useNavigate();

  if (connectionState === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-500">
        <p className="text-lg mb-2">No device connected</p>
        <p className="text-sm">Click Connect to pair with your uCrit device</p>
      </div>
    );
  }

  const sensors: SensorItem[] = [
    { key: 'co2', label: 'CO₂', value: fmtCO2(current.co2).replace(' ppm', ''), unit: 'ppm', score: current.co2 != null ? scoreCO2(current.co2) : null },
    { key: 'pm2_5', label: 'PM2.5', value: fmtPM(current.pm2_5).replace(' µg/m³', ''), unit: 'µg/m³', score: current.pm2_5 != null ? scorePM25(current.pm2_5) : null },
    { key: 'pm10', label: 'PM10', value: fmtPM(current.pm10).replace(' µg/m³', ''), unit: 'µg/m³', score: current.pm10 != null ? scorePM25(current.pm10) : null },
    { key: 'temperature', label: 'Temp', value: fmtTemp(current.temperature).replace(' °C', ''), unit: '°C', score: current.temperature != null ? scoreTemperature(current.temperature) : null },
    { key: 'humidity', label: 'Humidity', value: fmtHumidity(current.humidity).replace('%', ''), unit: '%', score: current.humidity != null ? scoreHumidity(current.humidity) : null },
    { key: 'voc', label: 'VOC', value: fmtIndex(current.voc), unit: 'index', score: current.voc != null ? scoreVOC(current.voc) : null },
    { key: 'nox', label: 'NOx', value: fmtIndex(current.nox), unit: 'index', score: current.nox != null ? scoreNOx(current.nox) : null },
    { key: 'pressure', label: 'Pressure', value: fmtPressure(current.pressure).replace(' hPa', ''), unit: 'hPa', score: null },
  ];

  const goToSensor = (key: string) => {
    navigate(`/history?sensor=${key}`);
  };

  return (
    <div className="space-y-6">
      {/* Hero AQ Score */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl">
        <AQScore />
      </div>

      {/* Sensor sub-scores grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {sensors.map(s => {
          const status = s.score != null ? sensorStatus(s.score) : null;
          const grade = s.score != null ? sensorBadnessToGrade(s.score) : null;

          return (
            <button
              key={s.key}
              onClick={() => goToSensor(s.key)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-left hover:border-gray-700 hover:bg-gray-900/80 transition-all group"
            >
              {/* Header: label + grade */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{s.label}</span>
                {grade && (
                  <span
                    className="text-sm font-bold px-1.5 py-0.5 rounded"
                    style={{ color: status?.color, backgroundColor: status?.color + '18' }}
                  >
                    {grade}
                  </span>
                )}
              </div>

              {/* Value */}
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold tabular-nums">{s.value}</span>
                <span className="text-xs text-gray-500">{s.unit}</span>
              </div>

              {/* Status bar */}
              {status && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color }} />
                  <span className="text-[10px] font-medium" style={{ color: status.color }}>{status.label}</span>
                </div>
              )}

              {/* Subtle arrow indicator */}
              <div className="mt-2 flex justify-end">
                <ChevronRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
