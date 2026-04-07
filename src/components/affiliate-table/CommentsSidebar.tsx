'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AffiliateComment } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { X, Send, Loader2, MessageSquare } from 'lucide-react';

interface CommentsSidebarProps {
  affiliateCreatorId: string | null;
  handle: string;
  onClose: () => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function CommentsSidebar({
  affiliateCreatorId,
  handle,
  onClose,
}: CommentsSidebarProps) {
  const [comments, setComments] = useState<AffiliateComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [content, setContent] = useState('');
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch comments
  useEffect(() => {
    if (!affiliateCreatorId) return;

    async function fetchComments() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/affiliates/comments?affiliate_creator_id=${affiliateCreatorId}`
        );
        if (res.ok) {
          const data = await res.json();
          setComments(data);
        }
      } catch (err) {
        console.error('Failed to fetch comments:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchComments();
  }, [affiliateCreatorId]);

  // Auto-scroll when comments change
  useEffect(() => {
    if (comments.length > 0) {
      scrollToBottom();
    }
  }, [comments, scrollToBottom]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!authorName.trim() || !content.trim() || !affiliateCreatorId) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/affiliates/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_creator_id: affiliateCreatorId,
          author_name: authorName.trim(),
          content: content.trim(),
        }),
      });

      if (res.ok) {
        const newComment = await res.json();
        setComments((prev) => [...prev, newComment]);
        setContent('');
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
    }
  }

  const isOpen = affiliateCreatorId !== null;

  return (
    <div
      className={`fixed top-0 right-0 z-40 h-full w-80 bg-background border-l border-border shadow-lg transform transition-transform duration-200 ease-in-out flex flex-col ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold truncate">
            Comments for @{handle}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Comments list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No comments yet</p>
          </div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-lg bg-muted/50 p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {comment.author_name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(comment.created_at)}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {comment.content}
              </p>
            </div>
          ))
        )}
        <div ref={commentsEndRef} />
      </div>

      {/* Comment form */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border px-4 py-3 space-y-2"
      >
        <Input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="Your name"
          className="h-8 text-sm"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a comment..."
          rows={2}
          className="text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={!authorName.trim() || !content.trim() || submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submitting ? 'Sending...' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
