"use client";

interface StatusBadgeProps {
  uploaded: number;
  assigned: number;
}

export default function StatusBadge({ uploaded, assigned }: StatusBadgeProps) {
  let label = "Not Started";
  let colorClass = "bg-gray-100 text-gray-600";

  if (uploaded >= assigned && assigned > 0) {
    label = "Completed";
    colorClass = "bg-green-100 text-green-800";
  } else if (uploaded > 0) {
    label = "In Progress";
    colorClass = "bg-amber-100 text-amber-800";
  }

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
