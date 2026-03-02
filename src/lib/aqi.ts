import type { SensorValues } from '../types/index.ts';

/** Piecewise linear interpolation. Points must be sorted by x. */
function lerp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

// Scoring curves from firmware (cat_air.c) — 0 = best, 5 = worst
const tempCurve: [number, number][] = [
  [0, 5], [8, 5], [16, 4], [18, 3], [20, 1], [25, 0], [27, 1], [29, 3], [34, 4], [35, 5],
];
const rhCurve: [number, number][] = [
  [0, 5], [14, 5], [23, 4], [30, 3], [40, 1], [50, 0], [60, 1], [65, 3], [80, 4], [85, 5],
];
const co2Curve: [number, number][] = [
  [0, 0], [420, 0], [800, 1], [1000, 2], [1400, 3], [4500, 5],
];
const pm25Curve: [number, number][] = [
  [0, 0], [5, 1], [12, 2], [35, 3], [55, 4], [150, 5],
];
const noxCurve: [number, number][] = [
  [0, 0], [1, 0.5], [90, 2], [150, 3], [300, 4], [310, 5],
];
const vocCurve: [number, number][] = [
  [0, 0], [100, 0.5], [150, 2], [250, 3], [400, 4], [410, 5],
];

export function scoreTemperature(v: number): number { return lerp(tempCurve, v); }
export function scoreHumidity(v: number): number { return lerp(rhCurve, v); }
export function scoreCO2(v: number): number { return lerp(co2Curve, v); }
export function scorePM25(v: number): number { return lerp(pm25Curve, v); }
export function scoreNOx(v: number): number { return lerp(noxCurve, v); }
export function scoreVOC(v: number): number { return lerp(vocCurve, v); }

export interface AQScoreResult {
  score: number;     // 0-5 badness
  goodness: number;  // 0-100 percentage (100 = best)
  color: string;     // CSS color
  label: string;
}

/**
 * Compute aggregate IAQ score matching firmware algorithm.
 * Returns badness (0-5) and goodness (0-100%).
 */
export function computeAQScore(sensors: SensorValues): AQScoreResult {
  const scores = {
    co2: sensors.co2 != null ? scoreCO2(sensors.co2) : 0,
    pm25: sensors.pm2_5 != null ? scorePM25(sensors.pm2_5) : 0,
    nox: sensors.nox != null ? scoreNOx(sensors.nox) : 0,
    voc: sensors.voc != null ? scoreVOC(sensors.voc) : 0,
    temp: sensors.temperature != null ? scoreTemperature(sensors.temperature) : 0,
    rh: sensors.humidity != null ? scoreHumidity(sensors.humidity) : 0,
  };

  // Base score = worst pollutant
  let baseScore = Math.max(scores.co2, scores.pm25, scores.nox, scores.voc);

  // Multiple pollutants penalty
  const badCount = [scores.co2, scores.pm25, scores.nox, scores.voc].filter(s => s > 3).length;
  if (badCount > 1) {
    baseScore += (badCount - 1) * 0.5;
  }

  // Temperature & humidity multipliers
  const tempMult = 1.0 + Math.max(0, scores.temp - 1.0) * 0.1;
  const rhMult = 1.0 + Math.max(0, scores.rh - 1.0) * 0.1;

  const finalScore = Math.min(5, Math.round(baseScore * tempMult * rhMult * 100) / 100);
  const goodness = Math.round(((5 - finalScore) / 5) * 100);

  return {
    score: finalScore,
    goodness,
    color: goodnessColor(goodness),
    label: goodnessLabel(goodness),
  };
}

export function goodnessColor(goodness: number): string {
  if (goodness >= 80) return '#22c55e'; // green
  if (goodness >= 60) return '#eab308'; // yellow
  if (goodness >= 40) return '#f97316'; // orange
  return '#ef4444';                     // red
}

export function goodnessLabel(goodness: number): string {
  if (goodness >= 80) return 'Good';
  if (goodness >= 60) return 'Fair';
  if (goodness >= 40) return 'Poor';
  return 'Bad';
}

/** Get individual sensor score label and color. */
export function sensorStatus(score: number): { color: string; label: string } {
  if (score <= 1) return { color: '#22c55e', label: 'Good' };
  if (score <= 2) return { color: '#eab308', label: 'Fair' };
  if (score <= 3) return { color: '#f97316', label: 'Poor' };
  return { color: '#ef4444', label: 'Bad' };
}

/**
 * 13 letter grades matching firmware cat_air.c:
 * F, D-, D, D+, C-, C, C+, B-, B, B+, A-, A, A+
 * Uses firmware's quantize(score, 1, 13) where score = goodness/100.
 */
const GRADES = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];

/** Map goodness (0-100) to a letter grade (F through A+). */
export function goodnessToGrade(goodness: number): string {
  const normalized = Math.max(0, Math.min(100, goodness)) / 100;
  const index = Math.round(normalized * 12);
  return GRADES[Math.max(0, Math.min(12, index))];
}

/** Map individual sensor badness (0-5) to a letter grade. */
export function sensorBadnessToGrade(badness: number): string {
  const goodness = ((5 - Math.min(5, Math.max(0, badness))) / 5) * 100;
  return goodnessToGrade(goodness);
}
