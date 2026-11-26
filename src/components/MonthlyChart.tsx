import { useState } from 'react';
import type { MonthlyBucket } from '../types';

interface MonthlyChartProps {
  data: MonthlyBucket[];
}

export function MonthlyChart({ data }: MonthlyChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = Math.max(
    4,
    ...data.flatMap((d) => [d.borrowed, d.returned, d.overdue])
  );
  const yMax = Math.ceil(maxVal / 2) * 2;
  const chartHeight = 200;
  const barWidth = 18;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm font-semibold text-slate-900">
          Tren Sirkulasi 6 Bulan Terakhir
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1E3A5F]" />
            <span>Peminjaman</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" />
            <span>Pengembalian</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-600" />
            <span>Keterlambatan</span>
          </span>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <div className="min-w-[520px] pt-4 pb-2">
          <svg
            viewBox={`0 0 ${data.length * 105 + 40} ${chartHeight + 44}`}
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label="Grafik statistik peminjaman, pengembalian, dan keterlambatan bulanan"
          >
            {/* Horizontal grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = chartHeight - ratio * chartHeight + 10;
              const val = Math.round(ratio * yMax);
              return (
                <g key={ratio}>
                  <line
                    x1={32}
                    x2={data.length * 105 + 32}
                    y1={y}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray={ratio === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={24}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Grouped bars */}
            {data.map((bucket, idx) => {
              const groupX = 48 + idx * 105;
              const hBorrow = (bucket.borrowed / yMax) * chartHeight;
              const hReturn = (bucket.returned / yMax) * chartHeight;
              const hOverdue = (bucket.overdue / yMax) * chartHeight;
              const isHovered = hoveredIdx === idx;

              return (
                <g
                  key={bucket.month}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  {isHovered && (
                    <rect
                      x={groupX - 8}
                      y={6}
                      width={78}
                      height={chartHeight + 10}
                      rx={6}
                      fill="#F1F5F9"
                    />
                  )}
                  <rect
                    x={groupX}
                    y={chartHeight + 10 - hBorrow}
                    width={barWidth}
                    height={Math.max(2, hBorrow)}
                    rx={3}
                    fill="#1E3A5F"
                  />
                  <rect
                    x={groupX + barWidth + 4}
                    y={chartHeight + 10 - hReturn}
                    width={barWidth}
                    height={Math.max(2, hReturn)}
                    rx={3}
                    fill="#16A34A"
                  />
                  <rect
                    x={groupX + (barWidth + 4) * 2}
                    y={chartHeight + 10 - hOverdue}
                    width={barWidth}
                    height={Math.max(2, hOverdue)}
                    rx={3}
                    fill="#DC2626"
                  />
                  <text
                    x={groupX + 30}
                    y={chartHeight + 30}
                    textAnchor="middle"
                    className="fill-slate-600 text-[11px] font-medium"
                  >
                    {bucket.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Clean tabular summary row below chart */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-3 border-t border-slate-100">
          {data.map((bucket, idx) => (
            <div
              key={bucket.month}
              className={`p-2 rounded-md text-xs transition-colors ${
                hoveredIdx === idx ? 'bg-slate-100' : 'bg-slate-50/70'
              }`}
            >
              <div className="font-medium text-slate-800">{bucket.label}</div>
              <div className="font-mono text-[11px] text-slate-600 tabular-nums mt-0.5">
                {bucket.borrowed} pinjam · {bucket.returned} kembali · {bucket.overdue} telat
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
