import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCssVar } from '../../lib/use-css-var';
import { Button } from '../ui';

interface Point {
  hour: number;
  count: number;
}

const hourLabel = (h: number) => `${h.toString().padStart(2, '0')}:00`;

/** Single-series magnitude over the day: one hue, thin rounded bars, hover tooltip, table view. */
export function HourlyPunchesChart({ data }: { data: Point[] }) {
  const [asTable, setAsTable] = useState(false);
  const series = useCssVar('--series-1', '#2a78d6');
  const grid = useCssVar('--grid', '#e8e7e3');
  const ink = useCssVar('--ink-3', '#75746f');

  // Show the working part of the day, widened to include any off-hours activity.
  const active = data.filter((d) => d.count > 0).map((d) => d.hour);
  const from = Math.min(5, ...active);
  const to = Math.max(22, ...active);
  const visible = data.filter((d) => d.hour >= from && d.hour <= to);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Ver gráfico' : 'Ver tabla'}
        </Button>
      </div>
      {asTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="py-1 font-medium">Hora</th>
              <th className="py-1 text-right font-medium">Marcaciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.hour} className="border-t border-line">
                <td className="py-1">{hourLabel(d.hour)}</td>
                <td className="tabular py-1 text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="h-56" role="img" aria-label="Marcaciones por hora del día">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={visible}
              margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              barCategoryGap="18%"
            >
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis
                dataKey="hour"
                tickFormatter={(h: number) => h.toString().padStart(2, '0')}
                tick={{ fill: ink, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: grid }}
                interval={1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: ink, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: grid, opacity: 0.6 }}
                content={({ active: isActive, payload }) => {
                  const point = payload?.[0]?.payload as Point | undefined;
                  if (!isActive || !point) return null;
                  return (
                    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs shadow-md">
                      <p className="font-medium text-ink-1">
                        {hourLabel(point.hour)} – {hourLabel(point.hour + 1)}
                      </p>
                      <p className="tabular text-ink-2">{point.count} marcaciones</p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="count"
                fill={series}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
