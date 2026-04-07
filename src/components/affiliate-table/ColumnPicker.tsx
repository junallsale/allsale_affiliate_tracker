'use client';

import React from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ColumnDef } from '@/lib/affiliate-columns';

interface ColumnPickerProps {
  allColumns: ColumnDef[];
  visibleColumns: string[];
  onChange: (visibleColumns: string[]) => void;
}

export default function ColumnPicker({
  allColumns,
  visibleColumns,
  onChange,
}: ColumnPickerProps) {
  const visibleSet = new Set(visibleColumns);

  const toggleColumn = (key: string) => {
    if (visibleSet.has(key)) {
      onChange(visibleColumns.filter((k) => k !== key));
    } else {
      onChange([...visibleColumns, key]);
    }
  };

  const showAll = () => {
    onChange(allColumns.map((c) => c.key));
  };

  const hideAll = () => {
    onChange([]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Columns</span>
            <div className="flex gap-1">
              <button
                onClick={showAll}
                className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
              >
                Show all
              </button>
              <button
                onClick={hideAll}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                Hide all
              </button>
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {allColumns.map((col) => {
              const isVisible = visibleSet.has(col.key);
              return (
                <label
                  key={col.key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50',
                    isVisible ? 'text-gray-900' : 'text-gray-400'
                  )}
                >
                  <Checkbox
                    checked={isVisible}
                    onCheckedChange={() => toggleColumn(col.key)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate">{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
