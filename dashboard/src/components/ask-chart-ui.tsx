"use client";

import { useAssistantToolUI } from "@assistant-ui/react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const DEFAULT_COLORS = [
  "#2D72D2", // accent blue
  "#29A634", // green
  "#D1980B", // gold
  "#C23030", // red
  "#9179F2", // purple
  "#F5498B", // pink
];

interface ChartArgs {
  type: "bar" | "line" | "pie";
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string | string[];
  colors?: string[];
}

function ChartRenderer({ args }: { args: ChartArgs }) {
  const { type, title, data, xKey, yKey, colors } = args;
  const palette = colors?.length ? colors : DEFAULT_COLORS;
  const yKeys = Array.isArray(yKey) ? yKey : [yKey];

  if (!data || data.length === 0) {
    return (
      <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
        No data to chart
      </div>
    );
  }

  return (
    <div className="my-2">
      <div className="text-xs font-medium text-foreground mb-2">{title}</div>
      <div className="rounded-md border border-border bg-background p-2">
        <ResponsiveContainer width="100%" height={200}>
          {type === "pie" ? (
            <PieChart>
              <Pie
                data={data}
                dataKey={yKeys[0]}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name }) => String(name)}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={palette[i % palette.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#252A31",
                  border: "1px solid #383E47",
                  borderRadius: "2px",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          ) : type === "line" ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#383E47" />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 11, fill: "#A7B6C2" }}
                stroke="#383E47"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#A7B6C2" }}
                stroke="#383E47"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#252A31",
                  border: "1px solid #383E47",
                  borderRadius: "2px",
                  fontSize: "12px",
                }}
              />
              {yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={palette[i % palette.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#383E47" />
              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 11, fill: "#A7B6C2" }}
                stroke="#383E47"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#A7B6C2" }}
                stroke="#383E47"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#252A31",
                  border: "1px solid #383E47",
                  borderRadius: "2px",
                  fontSize: "12px",
                }}
              />
              {yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={palette[i % palette.length]}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function GenerateChartToolUI({
  args,
}: {
  args: ChartArgs;
  result?: unknown;
  [key: string]: unknown;
}) {
  if (!args) {
    return (
      <div className="text-xs text-muted-foreground animate-pulse py-1">
        Generating chart...
      </div>
    );
  }

  return <ChartRenderer args={args} />;
}

export function useGenerateChartToolUI() {
  useAssistantToolUI({
    toolName: "generate_chart",
    render: GenerateChartToolUI,
  });
}
