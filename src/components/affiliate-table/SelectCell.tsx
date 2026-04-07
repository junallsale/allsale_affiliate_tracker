'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface SelectCellProps {
  value: string | null;
  options: { value: string; color?: string; label?: string }[];
  editable: boolean;
  onChange: (value: string | null) => void;
  className?: string;
  displayLabel?: (value: string) => string | undefined;
}

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}

export default function SelectCell({
  value,
  options,
  editable,
  onChange,
  className,
  displayLabel,
}: SelectCellProps) {
  const [open, setOpen] = useState(false);

  const selectedOption = options.find((o) => o.value === value);
  const bgColor = selectedOption?.color ?? '#e5e7eb';
  const textColor = selectedOption?.color ? getContrastColor(selectedOption.color) : '#374151';
  const displayText = value ? (displayLabel?.(value) ?? selectedOption?.label ?? value) : null;

  if (!editable) {
    return (
      <div className={cn('flex h-8 w-full items-center px-2 py-1', className)}>
        {displayText ? (
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: bgColor, color: textColor }}
          >
            {displayText}
          </span>
        ) : (
          <span className="text-sm text-gray-300">&mdash;</span>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex h-8 w-full cursor-pointer items-center px-2 py-1 text-left hover:bg-gray-50',
            className
          )}
        >
          {displayText ? (
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: bgColor, color: textColor }}
            >
              {displayText}
            </span>
          ) : (
            <span className="text-sm text-gray-300">&mdash;</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        <div className="flex flex-col gap-0.5">
          {options.map((option) => {
            const optBg = option.color ?? '#e5e7eb';
            const optText = option.color ? getContrastColor(option.color) : '#374151';
            const optLabel = option.label ?? option.value;
            return (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100',
                  value === option.value && 'bg-gray-100'
                )}
              >
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: optBg, color: optText }}
                >
                  {optLabel}
                </span>
              </button>
            );
          })}
          <div className="my-0.5 border-t" />
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-100"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
