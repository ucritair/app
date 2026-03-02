import { computeAQScore, goodnessToGrade } from '../lib/aqi.ts';
import { useSensorStore } from '../stores/sensors.ts';

export default function AQScore() {
  const current = useSensorStore(s => s.current);
  const hasData = Object.values(current).some(v => v !== null);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-44 h-44 rounded-full border-8 border-gray-800 flex items-center justify-center">
          <span className="text-4xl text-gray-600">--</span>
        </div>
        <p className="mt-4 text-sm text-gray-500">Connect device to see AQ score</p>
      </div>
    );
  }

  const { goodness, color, label } = computeAQScore(current);
  const grade = goodnessToGrade(goodness);

  // SVG circular gauge — larger for hero display
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const progress = (goodness / 100) * circumference;

  return (
    <div className="flex flex-col items-center py-6">
      <svg viewBox="0 0 160 160" className="w-44 h-44">
        {/* Background circle */}
        <circle
          cx="80" cy="80" r={radius}
          fill="none" stroke="#1f2937" strokeWidth="8"
        />
        {/* Progress arc */}
        <circle
          cx="80" cy="80" r={radius}
          fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          transform="rotate(-90 80 80)"
          className="transition-all duration-500"
        />
        {/* Letter grade — big and centered */}
        <text x="80" y="72" textAnchor="middle" className="fill-current text-white" style={{ fontSize: '40px', fontWeight: 800 }}>
          {grade}
        </text>
        {/* Numeric score */}
        <text x="80" y="96" textAnchor="middle" style={{ fontSize: '16px', fill: '#9ca3af', fontWeight: 500 }}>
          {goodness}
        </text>
        {/* Label */}
        <text x="80" y="116" textAnchor="middle" style={{ fontSize: '13px', fill: color, fontWeight: 600 }}>
          {label}
        </text>
      </svg>
      <p className="mt-2 text-xs text-gray-500">Air Quality Score</p>
    </div>
  );
}
