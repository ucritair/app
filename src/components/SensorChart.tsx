import { useRef, useEffect, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  data: (number | null)[];
  color: string;
  scale: string;  // scale key: 'ppm', 'ugm3', 'celsius', 'pct', 'index', 'hpa'
  unit: string;   // display unit: 'ppm', 'µg/m³', '°C', '%', '', 'hPa'
}

interface SensorChartProps {
  timestamps: number[];  // Unix seconds (device local time stored as fake UTC)
  series: ChartSeries[];
  height?: number;
}

// Which side each scale renders on (3 = left, 1 = right)
const SCALE_SIDES: Record<string, number> = {
  ppm: 3,
  ugm3: 1,
  celsius: 3,
  pct: 1,
  index: 3,
  hpa: 1,
};

const AXIS_COLORS: Record<string, string> = {
  ppm: '#ef4444',
  ugm3: '#f97316',
  celsius: '#3b82f6',
  pct: '#06b6d4',
  index: '#8b5cf6',
  hpa: '#6b7280',
};

export default function SensorChart({ timestamps, series, height = 300 }: SensorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const resetZoom = useCallback(() => {
    if (chartRef.current && timestamps.length > 0) {
      chartRef.current.setScale('x', {
        min: timestamps[0],
        max: timestamps[timestamps.length - 1],
      });
      setIsZoomed(false);
    }
  }, [timestamps]);

  useEffect(() => {
    if (!containerRef.current || timestamps.length === 0) return;

    // Determine which scales are active
    const activeScales = [...new Set(series.map(s => s.scale))];

    // Build scales config
    const scales: Record<string, uPlot.Scale> = {
      x: { time: true },
    };
    for (const scale of activeScales) {
      scales[scale] = {
        auto: true,
        range: (_u: uPlot, min: number, max: number) => {
          const pad = (max - min) * 0.1 || 1;
          return [min - pad, max + pad];
        },
      };
    }

    // Build axes: x-axis + one axis per active scale
    const axes: uPlot.Axis[] = [
      {
        stroke: '#6b7280',
        grid: { stroke: '#1f2937', width: 1 },
        ticks: { stroke: '#374151', width: 1 },
        font: '11px system-ui',
        space: 80,
        values: (_u: uPlot, vals: number[]) => {
          const span = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
          return vals.map(v => {
            const d = new Date(v * 1000);
            if (span > 7 * 86400) {
              return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
            } else if (span > 86400) {
              return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }) + '\n' +
                d.toLocaleTimeString(undefined, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
            } else {
              return d.toLocaleTimeString(undefined, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
            }
          });
        },
      },
    ];

    for (let i = 0; i < activeScales.length; i++) {
      const scale = activeScales[i];
      const side = SCALE_SIDES[scale] ?? 3;
      const color = AXIS_COLORS[scale] ?? '#6b7280';
      const unitLabel = series.find(s => s.scale === scale)?.unit ?? '';

      axes.push({
        scale,
        side,
        stroke: color,
        grid: i === 0 ? { stroke: '#1f2937', width: 1 } : { show: false },
        ticks: { stroke: color + '40', width: 1 },
        font: '11px system-ui',
        size: 55,
        label: unitLabel,
        labelSize: 14,
        labelFont: '11px system-ui',
        gap: 4,
        values: (_u: uPlot, vals: number[]) => vals.map(v => {
          if (scale === 'ppm' || scale === 'index') return Math.round(v).toString();
          if (scale === 'hpa') return v.toFixed(0);
          return v.toFixed(1);
        }),
      });
    }

    // Build uPlot data
    const data: uPlot.AlignedData = [
      timestamps,
      ...series.map(s => s.data as (number | null | undefined)[]),
    ];

    // Build uPlot series config
    const uSeries: uPlot.Series[] = [
      {
        // X-axis: format cursor timestamp for the legend
        value: (_u: uPlot, ts: number) => {
          if (!ts) return '';
          const d = new Date(ts * 1000);
          return d.toLocaleString(undefined, {
            timeZone: 'UTC',
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        },
      },
      ...series.map(s => ({
        label: s.label,
        stroke: s.color,
        width: 1.5,
        scale: s.scale,
        spanGaps: false,
        points: { show: false },
        // Format cursor value for the legend
        value: (_u: uPlot, val: number | null | undefined) =>
          val == null ? '--' : (
            s.scale === 'ppm' || s.scale === 'index' ? `${Math.round(val)} ${s.unit}` :
            s.scale === 'hpa' ? `${val.toFixed(0)} ${s.unit}` :
            `${val.toFixed(1)} ${s.unit}`
          ),
      })),
    ];

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height,
      cursor: {
        show: true,
        drag: { x: true, y: false, setScale: true },
      },
      legend: { show: true, live: true },
      scales,
      axes,
      series: uSeries,
      hooks: {
        setScale: [
          (u: uPlot, scaleKey: string) => {
            if (scaleKey === 'x') {
              const xMin = u.scales.x.min ?? 0;
              const xMax = u.scales.x.max ?? 0;
              const fullMin = timestamps[0];
              const fullMax = timestamps[timestamps.length - 1];
              const zoomed = Math.abs(xMin - fullMin) > 1 || Math.abs(xMax - fullMax) > 1;
              setIsZoomed(zoomed);
            }
          },
        ],
      },
    };

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [timestamps, series, height]);

  // Touch pinch-to-zoom, touch pan, and scroll-wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dpr = window.devicePixelRatio || 1;

    // Convert a client X pixel to a chart time value
    const pxToVal = (clientX: number): number | null => {
      const chart = chartRef.current;
      if (!chart) return null;
      const rect = el.getBoundingClientRect();
      const plotLeft = chart.bbox.left / dpr;
      const plotWidth = chart.bbox.width / dpr;
      const frac = (clientX - rect.left - plotLeft) / plotWidth;
      const min = chart.scales.x.min ?? 0;
      const max = chart.scales.x.max ?? 0;
      return min + frac * (max - min);
    };

    const fullMin = () => timestamps[0];
    const fullMax = () => timestamps[timestamps.length - 1];

    const clampAndSet = (newMin: number, newMax: number) => {
      const chart = chartRef.current;
      if (!chart) return;
      const fMin = fullMin();
      const fMax = fullMax();
      // Don't zoom out past full range
      if (newMax - newMin >= fMax - fMin) {
        chart.setScale('x', { min: fMin, max: fMax });
      } else {
        // Clamp to bounds
        if (newMin < fMin) { newMax += fMin - newMin; newMin = fMin; }
        if (newMax > fMax) { newMin -= newMax - fMax; newMax = fMax; }
        chart.setScale('x', {
          min: Math.max(fMin, newMin),
          max: Math.min(fMax, newMax),
        });
      }
    };

    // --- Scroll wheel zoom ---
    const handleWheel = (e: WheelEvent) => {
      const chart = chartRef.current;
      if (!chart) return;
      e.preventDefault();

      const min = chart.scales.x.min ?? 0;
      const max = chart.scales.x.max ?? 0;
      const range = max - min;
      const centerVal = pxToVal(e.clientX);
      if (centerVal == null) return;

      const factor = e.deltaY > 0 ? 1.25 : 0.8; // scroll down = zoom out
      const newRange = range * factor;
      const frac = (centerVal - min) / range;
      clampAndSet(centerVal - frac * newRange, centerVal - frac * newRange + newRange);
    };

    // --- Touch pinch-to-zoom + pan ---
    let touchState: {
      type: 'none' | 'pan' | 'pinch';
      startX: number;
      startMin: number;
      startMax: number;
      initialDist: number;
      initialCenterX: number;
    } = { type: 'none', startX: 0, startMin: 0, startMax: 0, initialDist: 0, initialCenterX: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      const chart = chartRef.current;
      if (!chart) return;
      const min = chart.scales.x.min ?? 0;
      const max = chart.scales.x.max ?? 0;

      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        touchState = {
          type: 'pinch',
          startX: 0,
          startMin: min,
          startMax: max,
          initialDist: Math.sqrt(dx * dx + dy * dy),
          initialCenterX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        };
      } else if (e.touches.length === 1) {
        touchState = {
          type: 'pan',
          startX: e.touches[0].clientX,
          startMin: min,
          startMax: max,
          initialDist: 0,
          initialCenterX: 0,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const chart = chartRef.current;
      if (!chart) return;

      if (touchState.type === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scaleFactor = touchState.initialDist / dist; // >1 = zoom out

        const centerVal = pxToVal(touchState.initialCenterX);
        if (centerVal == null) return;
        const startRange = touchState.startMax - touchState.startMin;
        const newRange = startRange * scaleFactor;
        const frac = (centerVal - touchState.startMin) / startRange;
        clampAndSet(centerVal - frac * newRange, centerVal - frac * newRange + newRange);
      } else if (touchState.type === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        const plotWidth = chart.bbox.width / dpr;
        const range = touchState.startMax - touchState.startMin;
        const dx = e.touches[0].clientX - touchState.startX;
        const dt = -(dx / plotWidth) * range;
        clampAndSet(touchState.startMin + dt, touchState.startMax + dt);
      }
    };

    const handleTouchEnd = () => {
      touchState = { type: 'none', startX: 0, startMin: 0, startMax: 0, initialDist: 0, initialCenterX: 0 };
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [timestamps]);

  // Resize handler
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.setSize({
          width: containerRef.current.clientWidth,
          height,
        });
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [height]);

  return (
    <div className="relative">
      {isZoomed && (
        <button
          onClick={resetZoom}
          className="absolute top-2 right-2 z-10 px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-300 transition-colors"
        >
          Reset Zoom
        </button>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
