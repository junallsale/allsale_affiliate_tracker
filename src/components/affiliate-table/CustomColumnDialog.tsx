'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, X } from 'lucide-react';

interface CustomColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (column: {
    name: string;
    key: string;
    column_type: string;
    options: { value: string; color?: string }[];
  }) => void;
}

const COLUMN_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi Select' },
  { value: 'link', label: 'Link' },
  { value: 'email', label: 'Email' },
];

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#94a3b8'];

export function CustomColumnDialog({ open, onOpenChange, onAdd }: CustomColumnDialogProps) {
  const [name, setName] = useState('');
  const [columnType, setColumnType] = useState('text');
  const [options, setOptions] = useState<{ value: string; color: string }[]>([]);
  const [newOption, setNewOption] = useState('');

  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const showOptions = columnType === 'select' || columnType === 'multi_select';

  const handleAddOption = () => {
    if (!newOption.trim()) return;
    setOptions(prev => [...prev, {
      value: newOption.trim(),
      color: COLORS[prev.length % COLORS.length],
    }]);
    setNewOption('');
  };

  const handleSubmit = () => {
    if (!name.trim() || !key) return;
    onAdd({ name: name.trim(), key, column_type: columnType, options });
    setName('');
    setColumnType('text');
    setOptions([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Column Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Notes" />
            {key && <p className="text-xs text-muted-foreground mt-1">Key: {key}</p>}
          </div>
          <div>
            <Label>Type</Label>
            <select
              value={columnType}
              onChange={e => setColumnType(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {COLUMN_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {showOptions && (
            <div>
              <Label>Options</Label>
              <div className="space-y-2 mt-1">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: opt.color }}
                    />
                    <span className="text-sm flex-1">{opt.value}</span>
                    <button
                      onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newOption}
                    onChange={e => setNewOption(e.target.value)}
                    placeholder="New option..."
                    onKeyDown={e => e.key === 'Enter' && handleAddOption()}
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={handleAddOption}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>Add Column</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
