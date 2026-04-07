import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  12
);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateSlug(): string {
  return nanoid();
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

export function getProgressColor(ratio: number): string {
  if (ratio >= 1) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-primary";
  if (ratio > 0) return "bg-amber-500";
  return "bg-muted";
}

export function getProgressPercent(uploaded: number, assigned: number): number {
  if (assigned === 0) return 0;
  return Math.min(Math.round((uploaded / assigned) * 100), 100);
}

export function getCreatorStatus(
  uploaded: number,
  assigned: number
): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (assigned > 0 && uploaded >= assigned) return { label: "Completed", variant: "default" };
  if (uploaded > 0) return { label: "In Progress", variant: "secondary" };
  return { label: "Not Started", variant: "outline" };
}

export function getProjectStatusBadge(status: string): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    active: { label: "Active", variant: "default" },
    paused: { label: "Paused", variant: "secondary" },
    completed: { label: "Completed", variant: "outline" },
    archived: { label: "Archived", variant: "outline" },
  };
  return map[status] || map.active;
}
