import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLogStore } from '../stores/logs.ts';
import { useDeviceStore } from '../stores/device.ts';
import { useSimulationStore } from '../stores/simulation.ts';
import SensorChart from '../components/SensorChart.tsx';
import type { ChartSeries } from '../components/SensorChart.tsx';
import { logCellsToCSV, downloadCSV } from '../lib/export.ts';
import type { LogCell } from '../types/index.ts';
import { Download, Trash2, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

// Gap threshold: if consecutive cell timestamps differ by more than this, insert a break
const GAP_THRESHOLD = 360; // 6 minutes (2x normal ~3-min logging interval)

/**
 * Filter log cells to the longest monotonically-increasing timeline.
 * Handles timestamp discontinuities from timezone resets or device restarts.
 *
 * Algorithm:
 * 1. Split cells into segments at backward jumps or large forward gaps
 * 2. Use DP to find the longest chain of timestamp-compatible segments
 * 3. Return the merged cells from that chain
 */
function filterMonotonicTimeline(cells: LogCell[]): LogCell[] {
  if (cells.length <= 1) return cells;

  // Compute median forward delta to detect abnormal gaps
  const forwardDeltas: number[] = [];
  for (let i = 1; i < cells.length; i++) {
    const delta = cells[i].timestamp - cells[i - 1].timestamp;
    if (delta > 0 && delta < 7200) forwardDeltas.push(delta); // ignore huge gaps for median
  }
  forwardDeltas.sort((a, b) => a - b);
  const medianDelta = forwardDeltas.length > 0
    ? forwardDeltas[Math.floor(forwardDeltas.length / 2)]
    : 180; // fallback: 3 minutes

  // Split threshold: large enough to not split normal gaps, small enough to catch timezone jumps
  const splitThreshold = Math.max(medianDelta * 10, 1800); // at least 30 min

  // 1. Split into segments at discontinuities (backward jump or huge forward gap)
  const segments: LogCell[][] = [[cells[0]]];
  for (let i = 1; i < cells.length; i++) {
    const delta = cells[i].timestamp - cells[i - 1].timestamp;
    if (delta < 0 || delta > splitThreshold) {
      segments.push([]); // start new segment
    }
    segments[segments.length - 1].push(cells[i]);
  }

  if (segments.length === 1) return cells; // no discontinuities

  // 2. DP: find longest chain of compatible segments (by total cell count)
  const n = segments.length;
  const dp = new Array(n).fill(0);
  const prev = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    dp[i] = segments[i].length;
    for (let j = 0; j < i; j++) {
      const jEndTs = segments[j][segments[j].length - 1].timestamp;
      const iStartTs = segments[i][0].timestamp;
      if (iStartTs >= jEndTs && dp[j] + segments[i].length > dp[i]) {
        dp[i] = dp[j] + segments[i].length;
        prev[i] = j;
      }
    }
  }

  // 3. Backtrack from the last segment — most recent data is the source of truth
  const bestIdx = n - 1;

  const chain: number[] = [];
  for (let idx = bestIdx; idx !== -1; idx = prev[idx]) {
    chain.push(idx);
  }
  chain.reverse();

  // 4. Merge cells from the winning chain
  const result: LogCell[] = [];
  for (const idx of chain) {
    result.push(...segments[idx]);
  }
  return result;
}

interface SensorDef {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  scale: string;
  unit: string;
  extract: (c: LogCell) => number;
  format: (v: number) => string;
}

const sensorDefs: SensorDef[] = [
  { key: 'co2', label: 'CO2', shortLabel: 'CO\u2082', color: '#ef4444', scale: 'ppm', unit: 'ppm', extract: (c) => c.co2, format: (v) => Math.round(v).toString() },
  { key: 'pm2_5', label: 'PM2.5', shortLabel: 'PM2.5', color: '#f97316', scale: 'ugm3', unit: 'µg/m³', extract: (c) => c.pm[1], format: (v) => v.toFixed(1) },
  { key: 'pm10', label: 'PM10', shortLabel: 'PM10', color: '#eab308', scale: 'ugm3', unit: 'µg/m³', extract: (c) => c.pm[3], format: (v) => v.toFixed(1) },
  { key: 'temperature', label: 'Temperature', shortLabel: 'Temp', color: '#3b82f6', scale: 'celsius', unit: '°C', extract: (c) => c.temperature, format: (v) => v.toFixed(1) },
  { key: 'humidity', label: 'Humidity', shortLabel: 'RH', color: '#06b6d4', scale: 'pct', unit: '%', extract: (c) => c.humidity, format: (v) => v.toFixed(1) },
  { key: 'voc', label: 'VOC Index', shortLabel: 'VOC', color: '#8b5cf6', scale: 'index', unit: 'index', extract: (c) => c.voc, format: (v) => Math.round(v).toString() },
  { key: 'nox', label: 'NOx Index', shortLabel: 'NOx', color: '#ec4899', scale: 'index', unit: 'index', extract: (c) => c.nox, format: (v) => Math.round(v).toString() },
  { key: 'pressure', label: 'Pressure', shortLabel: 'hPa', color: '#6b7280', scale: 'hpa', unit: 'hPa', extract: (c) => c.pressure, format: (v) => v.toFixed(1) },
];

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';
const TIME_RANGE_SECONDS: Record<TimeRange, number> = {
  '1h': 3600,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  'all': Infinity,
};

// View mode: 'all' shows combined multi-axis chart, or a sensor key for individual view
type ViewMode = 'all' | string;

export default function History() {
  const { cells, isStreaming, streamProgress, cachedCount, error, loadCachedCells, downloadNewCells, downloadNewCellsQuiet, clearCache } = useLogStore();
  const connectionState = useDeviceStore(s => s.connectionState);
  const cellCount = useDeviceStore(s => s.cellCount);
  const simActive = useSimulationStore(s => s.active);
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize view mode from URL ?sensor= param (e.g. from Dashboard click)
  const initialSensor = searchParams.get('sensor');
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialSensor && sensorDefs.some(s => s.key === initialSensor) ? initialSensor : 'all'
  );
  const [visibleSensors, setVisibleSensors] = useState<Set<string>>(new Set(['co2', 'pm2_5', 'temperature']));
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [dayOffset, setDayOffset] = useState(0); // 0 = today, -1 = yesterday, etc.

  // Clear URL param after reading it (so back/forward works cleanly)
  useEffect(() => {
    if (initialSensor) {
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!simActive) loadCachedCells();
  }, [loadCachedCells, simActive]);

  // Auto-poll for new cells every ~4 minutes while connected (skip in simulation)
  const AUTO_POLL_INTERVAL = 240_000; // logging period (~3 min) + 1 min buffer
  useEffect(() => {
    if (connectionState !== 'connected' || simActive) return;
    const id = setInterval(() => { downloadNewCellsQuiet(); }, AUTO_POLL_INTERVAL);
    return () => clearInterval(id);
  }, [connectionState, downloadNewCellsQuiet, simActive]);

  // Reset day offset when switching away from 24h mode
  useEffect(() => {
    if (timeRange !== '24h') setDayOffset(0);
  }, [timeRange]);

  const toggleSensor = (key: string) => {
    setVisibleSensors(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Filter to longest monotonically-increasing timeline (handles timezone resets)
  const monotonicCells = useMemo(() => filterMonotonicTimeline(cells), [cells]);

  // Filter cells by selected time range
  const filteredCells = useMemo(() => {
    if (monotonicCells.length === 0) return monotonicCells;

    if (timeRange === '24h' && dayOffset !== 0) {
      // Day navigation mode: show a specific 24h window
      const latestTs = monotonicCells[monotonicCells.length - 1].timestamp;
      const dayEnd = latestTs + (dayOffset + 1) * 86400;
      const dayStart = dayEnd - 86400;
      return monotonicCells.filter(c => c.timestamp >= dayStart && c.timestamp < dayEnd);
    }

    if (timeRange === 'all') return monotonicCells;
    const latestTs = monotonicCells[monotonicCells.length - 1].timestamp;
    const cutoff = latestTs - TIME_RANGE_SECONDS[timeRange];
    return monotonicCells.filter(c => c.timestamp >= cutoff);
  }, [monotonicCells, timeRange, dayOffset]);

  // Build chart data with gap markers
  const chartData = useMemo(() => {
    if (filteredCells.length === 0) return { timestamps: [] as number[], cellIndices: [] as (number | null)[] };

    const timestamps: number[] = [];
    const cellIndices: (number | null)[] = [];

    for (let i = 0; i < filteredCells.length; i++) {
      if (i > 0 && filteredCells[i].timestamp - filteredCells[i - 1].timestamp > GAP_THRESHOLD) {
        const midTs = Math.floor((filteredCells[i - 1].timestamp + filteredCells[i].timestamp) / 2);
        timestamps.push(midTs);
        cellIndices.push(null);
      }
      timestamps.push(filteredCells[i].timestamp);
      cellIndices.push(i);
    }

    return { timestamps, cellIndices };
  }, [filteredCells]);

  // Build series for "All" mode
  const allSeries: ChartSeries[] = useMemo(() =>
    sensorDefs
      .filter(s => visibleSensors.has(s.key))
      .map(s => ({
        label: s.label,
        color: s.color,
        scale: s.scale,
        unit: s.unit,
        data: chartData.cellIndices.map(idx =>
          idx === null ? null : s.extract(filteredCells[idx])
        ),
      })),
    [filteredCells, visibleSensors, chartData],
  );

  // Build series for individual sensor mode
  const singleSeries: ChartSeries[] = useMemo(() => {
    const def = sensorDefs.find(s => s.key === viewMode);
    if (!def) return [];
    return [{
      label: def.label,
      color: def.color,
      scale: def.scale,
      unit: def.unit,
      data: chartData.cellIndices.map(idx =>
        idx === null ? null : def.extract(filteredCells[idx])
      ),
    }];
  }, [filteredCells, viewMode, chartData]);

  // Stats for individual sensor view
  const sensorStats = useMemo(() => {
    const def = sensorDefs.find(s => s.key === viewMode);
    if (!def || filteredCells.length === 0) return null;
    const values = filteredCells.map(c => def.extract(c));
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = values[values.length - 1];
    return { avg, min, max, latest, def };
  }, [filteredCells, viewMode]);

  // Day label for navigation
  const dayLabel = useMemo(() => {
    if (timeRange !== '24h') return null;
    if (dayOffset === 0) return 'Today';
    if (dayOffset === -1) return 'Yesterday';
    // Format the date
    if (monotonicCells.length === 0) return '';
    const latestTs = monotonicCells[monotonicCells.length - 1].timestamp;
    const dayTs = latestTs + dayOffset * 86400;
    const d = new Date(dayTs * 1000);
    return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  }, [timeRange, dayOffset, monotonicCells]);

  // Can navigate further back?
  const canGoBack = useMemo(() => {
    if (monotonicCells.length === 0 || timeRange !== '24h') return false;
    const latestTs = monotonicCells[monotonicCells.length - 1].timestamp;
    const earliestTs = monotonicCells[0].timestamp;
    const targetStart = latestTs + (dayOffset - 1) * 86400;
    return targetStart >= earliestTs - 86400;
  }, [monotonicCells, dayOffset, timeRange]);

  const handleExport = () => {
    if (cells.length === 0) return;
    const csv = logCellsToCSV(cells);
    const now = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `ucrit-logs-${now}.csv`);
  };

  const isIndividual = viewMode !== 'all';

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={downloadNewCells}
          disabled={isStreaming || connectionState !== 'connected' || simActive}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isStreaming ? 'animate-spin' : ''}`} />
          {isStreaming ? 'Downloading...' : 'Download New'}
        </button>

        <button
          onClick={handleExport}
          disabled={cells.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>

        <button
          onClick={clearCache}
          disabled={cachedCount === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Clear
        </button>

        <span className="text-sm text-gray-500 ml-auto">
          {monotonicCells.length !== cachedCount
            ? <>{monotonicCells.length} shown <span className="text-gray-600">({cachedCount - monotonicCells.length} discarded)</span></>
            : <>{cachedCount} cached</>
          }
          {cellCount != null && ` / ${cellCount} on device`}
        </span>
      </div>

      {/* Progress */}
      {streamProgress && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Downloading...</span>
            <span>{streamProgress.received} / {streamProgress.total}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${(streamProgress.received / streamProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Sensor selector — Awair-style tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        <button
          onClick={() => setViewMode('all')}
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            viewMode === 'all'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-gray-400 hover:text-gray-200 border border-transparent'
          }`}
        >
          <span className="text-base">All</span>
        </button>
        {sensorDefs.map(s => (
          <button
            key={s.key}
            onClick={() => setViewMode(s.key)}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
              viewMode === s.key
                ? 'border'
                : 'text-gray-400 hover:text-gray-200 border border-transparent'
            }`}
            style={viewMode === s.key ? {
              backgroundColor: s.color + '15',
              color: s.color,
              borderColor: s.color + '40',
            } : undefined}
          >
            <span className="text-base">{s.shortLabel}</span>
          </button>
        ))}
      </div>

      {/* Time range + day navigation */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(['1h', '24h', '7d', '30d', 'all'] as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => { setTimeRange(r); setDayOffset(0); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                timeRange === r
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>

        {/* Day navigation arrows (visible in 24h mode) */}
        {timeRange === '24h' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDayOffset(d => d - 1)}
              disabled={!canGoBack}
              className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-gray-300 min-w-[80px] text-center">
              {dayLabel}
            </span>
            <button
              onClick={() => setDayOffset(d => Math.min(0, d + 1))}
              disabled={dayOffset >= 0}
              className="p-1 rounded hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* "All" mode toggles */}
        {viewMode === 'all' && (
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {sensorDefs.map(s => (
              <button
                key={s.key}
                onClick={() => toggleSensor(s.key)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  visibleSensors.has(s.key)
                    ? 'border-transparent text-white'
                    : 'border-gray-700 text-gray-500 bg-transparent'
                }`}
                style={visibleSensors.has(s.key) ? { backgroundColor: s.color + '30', color: s.color, borderColor: s.color + '50' } : undefined}
              >
                {s.shortLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Individual sensor stats (Awair-style) */}
      {isIndividual && sensorStats && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-1">{sensorStats.def.label}</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-4xl font-bold" style={{ color: sensorStats.def.color }}>
                {sensorStats.def.format(sensorStats.latest)}
              </span>
              <span className="text-lg text-gray-400">{sensorStats.def.unit}</span>
            </div>
            <div className="flex justify-center gap-8 mt-3 text-sm">
              <div>
                <span className="text-gray-500">Avg </span>
                <span className="text-gray-300 tabular-nums">{sensorStats.def.format(sensorStats.avg)}</span>
              </div>
              <div>
                <span className="text-gray-500">Min </span>
                <span className="text-gray-300 tabular-nums">{sensorStats.def.format(sensorStats.min)}</span>
              </div>
              <div>
                <span className="text-gray-500">Max </span>
                <span className="text-gray-300 tabular-nums">{sensorStats.def.format(sensorStats.max)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {filteredCells.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <SensorChart
            timestamps={chartData.timestamps}
            series={isIndividual ? singleSeries : allSeries}
            height={isIndividual ? 280 : 350}
          />
        </div>
      ) : (
        <div className="text-center py-16 text-gray-500">
          <p>No log data{timeRange === '24h' && dayOffset < 0 ? ' for this day' : ''}. Download cells from your device to view history.</p>
        </div>
      )}

    </div>
  );
}
