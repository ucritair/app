/** Format temperature with appropriate unit. */
export function fmtTemp(celsius: number | null, useFahrenheit = false): string {
  if (celsius == null) return '--';
  if (useFahrenheit) {
    return `${(celsius * 9 / 5 + 32).toFixed(1)} °F`;
  }
  return `${celsius.toFixed(1)} °C`;
}

/** Format humidity. */
export function fmtHumidity(pct: number | null): string {
  if (pct == null) return '--';
  return `${pct.toFixed(1)}%`;
}

/** Format CO2 in ppm. */
export function fmtCO2(ppm: number | null): string {
  if (ppm == null) return '--';
  return `${Math.round(ppm)} ppm`;
}

/** Format PM in µg/m³. */
export function fmtPM(ugm3: number | null): string {
  if (ugm3 == null) return '--';
  return `${ugm3.toFixed(1)} µg/m³`;
}

/** Format pressure in hPa. */
export function fmtPressure(hpa: number | null): string {
  if (hpa == null) return '--';
  return `${hpa.toFixed(1)} hPa`;
}

/** Format VOC/NOx index. */
export function fmtIndex(idx: number | null): string {
  if (idx == null) return '--';
  return `${Math.round(idx)}`;
}

/** Format device timestamp as local date-time string.
 *  Device stores local time as "fake UTC", so we use timeZone:'UTC'
 *  to avoid the browser double-applying its timezone offset. */
export function fmtDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { timeZone: 'UTC' });
}

/** Format device timestamp as short time. */
export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/** Get current local time as a Unix-epoch-like number (matching device convention).
 *  The device stores local time directly as epoch, not real UTC.
 *  This matches the Python convention: calendar.timegm(time.localtime()) */
export function getLocalTimeAsEpoch(): number {
  const now = new Date();
  return Math.floor(now.getTime() / 1000) - (now.getTimezoneOffset() * 60);
}
