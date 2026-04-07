'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Send } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface Memo {
  id: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface MemoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCreatorId: string;
  creatorName: string;
  onMemoCountChange?: (pcId: string, count: number) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MemoDialog({
  open, onOpenChange, projectCreatorId, creatorName, onMemoCountChange,
}: MemoDialogProps) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const supabase = createSupabaseBrowser();

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('project_creator_memos')
      .select('*')
      .eq('project_creator_id', projectCreatorId)
      .order('created_at', { ascending: false });
    setMemos((data as Memo[]) || []);
    setLoading(false);
  }, [projectCreatorId, supabase]);

  useEffect(() => {
    if (open && projectCreatorId) fetchMemos();
  }, [open, projectCreatorId, fetchMemos]);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authorName = session?.user?.email || 'Unknown';

      const { error } = await supabase
        .from('project_creator_memos')
        .insert({
          project_creator_id: projectCreatorId,
          content: content.trim(),
          author_name: authorName,
        });

      if (error) throw error;
      setContent('');
      await fetchMemos();
      onMemoCountChange?.(projectCreatorId, memos.length + 1);
    } catch (err) {
      console.error('Error adding memo:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Memos — {creatorName}</DialogTitle>
          <DialogDescription className="text-xs">
            Add notes for internal tracking
          </DialogDescription>
        </DialogHeader>

        {/* Memo List */}
        <div className="max-h-[240px] overflow-y-auto space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : memos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No memos yet</p>
          ) : (
            memos.map(memo => (
              <div key={memo.id} className="p-2.5 rounded-lg bg-muted/50 space-y-1">
                <p className="text-sm whitespace-pre-wrap">{memo.content}</p>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{memo.author_name || 'Unknown'}</span>
                  <span>{timeAgo(memo.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <Separator />

        {/* New Memo Input */}
        <div className="flex gap-2">
          <textarea
            placeholder="Write a memo..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 text-sm rounded-md border border-input bg-background px-3 py-2 resize-none h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={submitting || !content.trim()}
            className="h-[60px] w-10"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
