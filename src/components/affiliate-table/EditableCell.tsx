'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface EditableCellProps {
  value: string | number | null;
  type: 'text' | 'number' | 'link' | 'email' | 'date' | 'computed';
  editable: boolean;
  onChange: (value: string | number | null) => void;
  className?: string;
}

function formatNumber(val: number): string {
  return val.toLocaleString('en-US');
}

function formatDate(val: string): string {
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return val;
  }
}

export default function EditableCell({
  value,
  type,
  editable,
  onChange,
  className,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEdit = useCallback(() => {
    if (!editable || type === 'computed') return;
    setEditValue(value != null ? String(value) : '');
    setIsEditing(true);
  }, [editable, type, value]);

  const save = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed === '') {
      onChange(null);
      return;
    }
    if (type === 'number') {
      const num = parseFloat(trimmed);
      onChange(isNaN(num) ? null : num);
    } else {
      onChange(trimmed);
    }
  }, [editValue, onChange, type]);

  const cancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [save, cancel]
  );

  if (isEditing) {
    const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'email' ? 'email' : 'text';
    return (
      <Input
        ref={inputRef}
        type={inputType}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-8 w-full rounded-none border-0 border-b-2 border-blue-500 bg-blue-50/50 px-2 py-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          className
        )}
      />
    );
  }

  // Display mode
  const isEmpty = value == null || value === '';

  if (isEmpty) {
    return (
      <div
        onClick={startEdit}
        className={cn(
          'flex h-8 w-full cursor-pointer items-center px-2 py-1 text-sm text-gray-300',
          !editable && 'cursor-default',
          className
        )}
      >
        &mdash;
      </div>
    );
  }

  // Formatted display
  let displayContent: React.ReactNode;

  switch (type) {
    case 'number':
    case 'computed': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      displayContent = isNaN(num) ? String(value) : formatNumber(num);
      break;
    }
    case 'link':
      displayContent = (
        <span className="flex items-center gap-1">
          <span className="truncate">{String(value)}</span>
          <a
            href={String(value)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0 text-blue-500 hover:text-blue-700"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      );
      break;
    case 'email':
      displayContent = (
        <a
          href={`mailto:${String(value)}`}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-blue-600 hover:underline"
        >
          {String(value)}
        </a>
      );
      break;
    case 'date':
      displayContent = formatDate(String(value));
      break;
    default:
      displayContent = String(value);
  }

  return (
    <div
      onClick={startEdit}
      className={cn(
        'flex h-8 w-full items-center truncate px-2 py-1 text-sm',
        editable && 'cursor-pointer hover:bg-gray-50',
        type === 'computed' && 'cursor-default font-medium text-gray-600',
        (type === 'number' || type === 'computed') && 'justify-end tabular-nums',
        className
      )}
    >
      {displayContent}
    </div>
  );
}
