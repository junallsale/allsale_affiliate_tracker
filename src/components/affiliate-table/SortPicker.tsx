'use client';

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { ColumnDef } from '@/lib/affiliate-columns';

interface SortPickerProps {
  columns: ColumnDef[];
  sortConfig: { column: string; direction: 'asc' | 'desc' } | null;
  onChange: (config: { column: string; direction: 'asc' | 'desc' } | null) => void;
}

export function SortPicker({ columns, sortConfig, onChange }: SortPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort
          {sortConfig && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({columns.find((c) => c.key === sortConfig.column)?.label})
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-2">
          <p className="text-sm font-medium">Sort by</p>
          <select
            value={sortConfig?.column || ''}
            onChange={(e) => {
              if (!e.target.value) {
                onChange(null);
              } else {
                onChange({
                  column: e.target.value,
                  direction: sortConfig?.direction || 'asc',
                });
              }
            }}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">None</option>
            {columns.map((col) => (
              <option key={col.key} value={col.key}>
                {col.label}
              </option>
            ))}
          </select>
          {sortConfig && (
            <div className="flex gap-2">
              <Button
                variant={sortConfig.direction === 'asc' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 h-8 gap-1"
                onClick={() => onChange({ ...sortConfig, direction: 'asc' })}
              >
                <ArrowUp className="h-3 w-3" /> Asc
              </Button>
              <Button
                variant={sortConfig.direction === 'desc' ? 'default' : 'outline'}
                size="sm"
                className="flex-1 h-8 gap-1"
                onClick={() => onChange({ ...sortConfig, direction: 'desc' })}
              >
                <ArrowDown className="h-3 w-3" /> Desc
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
