import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function AnalyticsVolumeChart({ data }) {
  return (
    <div className="analytics-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#168577" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#168577" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e8eeee" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#82949a', fontSize: 10 }} tickFormatter={(date) => date.slice(5)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: '#82949a', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip />
          <Area type="monotone" dataKey="shipments" name="Shipments" stroke="#168577" strokeWidth={2} fill="url(#volumeFill)" />
          <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#d59a3d" strokeWidth={2} fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
