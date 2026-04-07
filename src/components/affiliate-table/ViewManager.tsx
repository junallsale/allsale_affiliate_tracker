'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AffiliateView } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Link2,
  Check,
  X,
} from 'lucide-react';

interface ViewManagerProps {
  views: AffiliateView[];
  activeViewId: string | null;
  onViewChange: (viewId: string | null) => void;
  onCreateView: (name: string) => void;
  onDeleteView: (viewId: string) => void;
  onRenameView: (viewId: string, name: string) => void;
  onCopyShareLink: (slug: string) => void;
}

interface MenuPosition {
  top: number;
  left: number;
}

export default function ViewManager({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onDeleteView,
  onRenameView,
  onCopyShareLink,
}: ViewManagerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition>({ top: 0, left: 0 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mounted, setMounted] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

  const openMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, viewId: string) => {
    e.stopPropagation();
    if (menuOpenId === viewId) {
      setMenuOpenId(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
    setMenuOpenId(viewId);
  }, [menuOpenId]);

  function handleCreate() {
    const trimmed = newName.trim();
    if (trimmed) {
      onCreateView(trimmed);
      setNewName('');
      setIsCreating(false);
    }
  }

  function handleCreateKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') {
      setIsCreating(false);
      setNewName('');
    }
  }

  function handleRename(viewId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameView(viewId, trimmed);
    }
    setRenamingId(null);
    setRenameValue('');
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, viewId: string) {
    if (e.key === 'Enter') handleRename(viewId);
    if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameValue('');
    }
  }

  function startRename(view: AffiliateView) {
    setRenamingId(view.id);
    setRenameValue(view.name);
    setMenuOpenId(null);
  }

  const activeView = views.find((v) => v.id === menuOpenId);

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto scrollbar-hide">
        {/* All tab */}
        <button
          onClick={() => onViewChange(null)}
          className={`relative shrink-0 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
            activeViewId === null
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All
          {activeViewId === null && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>

        {/* View tabs */}
        {views.map((view) => (
          <div key={view.id} className="relative shrink-0 flex items-center group">
            {renamingId === view.id ? (
              <div className="flex items-center gap-1 px-1 py-1">
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => handleRenameKeyDown(e, view.id)}
                  onBlur={() => handleRename(view.id)}
                  className="h-7 w-28 text-sm"
                />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRename(view.id)}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenamingId(null); setRenameValue(''); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => onViewChange(view.id)}
                  className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    activeViewId === view.id
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {view.name}
                </button>
                {activeViewId === view.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}

                {/* Dropdown trigger — portal로 렌더링해서 overflow 클리핑 우회 */}
                <button
                  onClick={(e) => openMenu(e, view.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent transition-opacity"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </>
            )}
          </div>
        ))}

        {/* Add view */}
        {isCreating ? (
          <div className="flex items-center gap-1 px-1 py-1 shrink-0">
            <Input
              ref={createInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              onBlur={() => {
                if (!newName.trim()) {
                  setIsCreating(false);
                  setNewName('');
                }
              }}
              placeholder="View name..."
              className="h-7 w-32 text-sm"
            />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreate}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setIsCreating(false); setNewName(''); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Dropdown portal — overflow 클리핑 없이 body에 직접 렌더링 */}
      {mounted && menuOpenId && activeView && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
          className="w-44 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <button
            onClick={() => startRename(activeView)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            onClick={() => {
              onCopyShareLink(activeView.slug);
              setMenuOpenId(null);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Link2 className="h-3.5 w-3.5" />
            Copy share link
          </button>
          <button
            onClick={() => {
              onDeleteView(activeView.id);
              setMenuOpenId(null);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
