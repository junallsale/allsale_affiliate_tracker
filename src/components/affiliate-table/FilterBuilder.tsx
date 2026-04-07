'use client';

import React from 'react';
import { Filter, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ViewFilter } from '@/types/database';
import type { ColumnDef } from '@/lib/affiliate-columns';

interface BrandOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; brand_id: string; }

interface FilterBuilderProps {
  filters: ViewFilter[];
  columns: ColumnDef[];
  onChange: (filters: ViewFilter[]) => void;
  brands?: BrandOption[];
  projects?: ProjectOption[];
}

const OPERATORS: { value: ViewFilter['operator']; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '\u2265' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '\u2264' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

const HIDE_VALUE_OPERATORS = new Set<string>(['is_empty', 'is_not_empty']);

export default function FilterBuilder({ filters, columns, onChange, brands = [], projects = [] }: FilterBuilderProps) {
  const updateFilter = (index: number, patch: Partial<ViewFilter>) => {
    const updated = filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(updated);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const addFilter = () => {
    const defaultColumn = columns[0]?.key ?? '';
    onChange([...filters, { column: defaultColumn, operator: 'eq', value: '' }]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filter
          {filters.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-[20px] rounded-full px-1.5 text-xs"
            >
              {filters.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[560px] p-3" align="start">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-gray-700">Filters</div>

          {filters.length === 0 && (
            <div className="py-3 text-center text-sm text-gray-400">
              No filters applied
            </div>
          )}

          {filters.map((filter, index) => {
            const hideValue = HIDE_VALUE_OPERATORS.has(filter.operator);
            const isBrandCol = filter.column === 'brand_id';
            const isProjectCol = filter.column === 'project_id';
            const isSelectCol = !isBrandCol && !isProjectCol && (columns.find((c) => c.key === filter.column)?.type === 'select');
            const selectOptions = isSelectCol ? (columns.find((c) => c.key === filter.column)?.options || []) : [];
            // For project_id, optionally filter by selected brand
            const brandFilter = isProjectCol
              ? filters.find((f) => f.column === 'brand_id')?.value as string | undefined
              : undefined;
            const filteredProjects = isProjectCol && brandFilter
              ? projects.filter((p) => {
                  const brand = brands.find((b) => b.name.toLowerCase() === brandFilter.toLowerCase());
                  return brand ? p.brand_id === brand.id : true;
                })
              : projects;

            return (
              <div key={index} className="flex items-center gap-1.5">
                {/* Column select */}
                <select
                  value={filter.column}
                  onChange={(e) => updateFilter(index, { column: e.target.value, value: '' })}
                  className={cn(
                    'h-8 w-[150px] truncate rounded-md border border-input bg-background px-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                >
                  {columns.map((col) => (
                    <option key={col.key} value={col.key}>
                      {col.label}
                    </option>
                  ))}
                </select>

                {/* Operator select */}
                <select
                  value={filter.operator}
                  onChange={(e) =>
                    updateFilter(index, {
                      operator: e.target.value as ViewFilter['operator'],
                    })
                  }
                  className={cn(
                    'h-8 w-[120px] rounded-md border border-input bg-background px-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {/* Value input */}
                {!hideValue && isBrandCol && (
                  <select
                    value={filter.value != null ? String(filter.value) : ''}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className={cn(
                      'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  >
                    <option value="">Select brand...</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                )}
                {!hideValue && isProjectCol && (
                  <select
                    value={filter.value != null ? String(filter.value) : ''}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className={cn(
                      'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  >
                    <option value="">Select project...</option>
                    {filteredProjects.map((p) => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                )}
                {!hideValue && isSelectCol && (
                  <select
                    value={filter.value != null ? String(filter.value) : ''}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className={cn(
                      'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  >
                    <option value="">Select...</option>
                    {selectOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.value}</option>
                    ))}
                  </select>
                )}
                {!hideValue && !isBrandCol && !isProjectCol && !isSelectCol && (
                  <Input
                    value={filter.value != null ? String(filter.value) : ''}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    placeholder="Value..."
                    className="h-8 flex-1 text-sm"
                  />
                )}
                {hideValue && <div className="flex-1" />}

                {/* Remove button */}
                <button
                  onClick={() => removeFilter(index)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <Button
            variant="ghost"
            size="sm"
            onClick={addFilter}
            className="mt-1 h-8 w-fit gap-1.5 text-gray-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Add filter
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
