import type { LogCell } from '../types/index.ts';

/** Export log cells as CSV string. */
export function logCellsToCSV(cells: LogCell[]): string {
  const header = [
    'cell_number', 'timestamp', 'datetime', 'flags',
    'temperature_C', 'pressure_hPa', 'humidity_pct',
    'co2_ppm', 'co2_uncomp_ppm',
    'pm1_0', 'pm2_5', 'pm4_0', 'pm10',
    'pn0_5', 'pn1_0', 'pn2_5', 'pn4_0', 'pn10',
    'voc_index', 'nox_index',
    'stroop_cong_ms', 'stroop_incong_ms', 'stroop_throughput',
  ].join(',');

  const rows = cells.map(c => [
    c.cellNumber,
    c.timestamp,
    new Date(c.timestamp * 1000).toISOString(),
    c.flags,
    c.temperature.toFixed(3),
    c.pressure.toFixed(1),
    c.humidity.toFixed(2),
    c.co2,
    c.co2Uncomp,
    c.pm[0].toFixed(2), c.pm[1].toFixed(2), c.pm[2].toFixed(2), c.pm[3].toFixed(2),
    c.pn[0].toFixed(2), c.pn[1].toFixed(2), c.pn[2].toFixed(2), c.pn[3].toFixed(2), c.pn[4].toFixed(2),
    c.voc,
    c.nox,
    c.stroop.meanTimeCong.toFixed(3),
    c.stroop.meanTimeIncong.toFixed(3),
    c.stroop.throughput,
  ].join(','));

  return [header, ...rows].join('\n');
}

/** Trigger CSV file download in the browser. */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
