"use client";

import { useState } from "react";

// Grouped bars, one axis (counts). Palette: reference categorical slots 1–3 in
// fixed order, validated with the dataviz validator (slot 3 is < 3:1 on the
// light surface -> relief: legend + tooltip + table view are always available).
const SERIES = [
  { key: "lost", label: "แจ้งของหาย", color: "#2a78d6" },
  { key: "found", label: "แจ้งพบของ", color: "#eb6834" },
  { key: "returned", label: "ส่งคืนสำเร็จ", color: "#1baf7a" },
] as const;

type Month = { month: string; lost: number; found: number; returned: number };

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${TH_MONTH[m - 1]} ${String(y + 543).slice(2)}`;
}

/** Axis top: a "nice" number that is also even, so the mid tick is a whole number. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  let m = Math.ceil(v / (pow / 2)) * (pow / 2);
  if (m % 2 !== 0) m += 1;
  return m;
}

export function MonthlyChart({ data }: { data: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (data.length === 0) return <p className="text-sm text-gray-400">ไม่มีข้อมูลในช่วงที่เลือก</p>;

  const W = 720, H = 240, padL = 32, padR = 8, padT = 12, padB = 28;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.lost, d.found, d.returned])));
  const groupW = (W - padL - padR) / data.length;
  const barW = Math.max(4, Math.min(18, (groupW - 16) / 3 - 2));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-gray-700" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="จำนวนรายการรายเดือน: แจ้งของหาย แจ้งพบของ และส่งคืนสำเร็จ">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#6b7280">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const gx = padL + i * groupW + (groupW - (barW * 3 + 4)) / 2;
            return (
              <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* hit target larger than the marks */}
                <rect x={padL + i * groupW} y={padT} width={groupW} height={H - padT - padB} fill={hover === i ? "#f3f4f6" : "transparent"} />
                {SERIES.map((s, j) => {
                  const v = d[s.key];
                  const top = y(v);
                  const h = Math.max(0, H - padB - top);
                  const x = gx + j * (barW + 2);
                  const r = Math.min(4, h / 2, barW / 2);
                  // rounded data-end (top), square at the baseline
                  const path = h === 0 ? "" :
                    `M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H - padB} Z`;
                  return path ? <path key={s.key} d={path} fill={s.color} /> : null;
                })}
                <text x={padL + i * groupW + groupW / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#6b7280">
                  {monthLabel(d.month)}
                </text>
              </g>
            );
          })}
          <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#9ca3af" strokeWidth={1} />
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-md"
            // beside the hovered month (never on top of its bars); flips left in the last third
            style={
              hover >= (data.length * 2) / 3
                ? { right: `${100 - (hover / data.length) * 100}%`, marginRight: 6 }
                : { left: `${((hover + 1) / data.length) * 100}%`, marginLeft: 6 }
            }
          >
            <p className="mb-1 font-semibold text-gray-900">{monthLabel(data[hover].month)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 text-gray-700">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}: <strong className="text-gray-900">{data[hover][s.key]}</strong>
              </p>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-2 text-xs text-cdti-600 hover:underline">
        {showTable ? "ซ่อนตาราง" : "ดูเป็นตาราง"}
      </button>
      {showTable && (
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="py-1">เดือน</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 text-right">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-1">{monthLabel(d.month)}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className="py-1 text-right tabular-nums">{d[s.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
