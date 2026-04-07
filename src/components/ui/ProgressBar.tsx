"use client";

interface ProgressBarProps {
  current: number;
  total: number;
  size?: "sm" | "md";
}

export default function ProgressBar({ current, total, size = "md" }: ProgressBarProps) {
  const percent = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
  const ratio = total > 0 ? current / total : 0;

  let color = "bg-gray-300";
  if (ratio >= 1) color = "bg-green-500";
  else if (ratio >= 0.5) color = "bg-indigo-500";
  else if (ratio > 0) color = "bg-amber-500";

  const heightClass = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 bg-gray-200 rounded-full overflow-hidden ${heightClass}`}>
        <div
          className={`h-full ${color} rounded-full transition-all duration-300`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
        {current} / {total}
      </span>
    </div>
  );
}
