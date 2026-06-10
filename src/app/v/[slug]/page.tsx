'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { ExternalLink, MessageSquare, Send, X, Pencil, Trash2, Check } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AffiliateComment } from '@/types/database';
import { FIXED_COLUMNS } from '@/lib/affiliate-columns';

const MY_COMMENTS_KEY = 'my_comment_ids';

function getMyCommentIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MY_COMMENTS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveMyCommentId(id: string) {
  try {
    const ids = getMyCommentIds();
    ids.add(id);
    localStorage.setItem(MY_COMMENTS_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

function removeMyCommentId(id: string) {
  try {
    const ids = getMyCommentIds();
    ids.delete(id);
    localStorage.setItem(MY_COMMENTS_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

interface ViewData {
  view: {
    id: string;
    name: string;
    visible_columns: string[];
    column_order: string[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>[];
  commentCounts?: Record<string, number>;
}

export default function PublicViewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Comments
  const [commentTarget, setCommentTarget] = useState<{ id: string; handle: string } | null>(null);
  const [comments, setComments] = useState<AffiliateComment[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [myCommentIds, setMyCommentIds] = useState<Set<string>>(new Set());
  const [commentName, setCommentName] = useState('');
  const [commentContent, setCommentContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setMyCommentIds(getMyCommentIds());
  }, []);

  useEffect(() => {
    const fetchView = async () => {
      try {
        const res = await fetch(`/api/affiliates/views/${slug}`);
        if (!res.ok) {
          setError('View not found');
          return;
        }
        const data = await res.json();
        setViewData(data);
        setCommentCounts(data.commentCounts || {});
      } catch {
        setError('Failed to load view');
      } finally {
        setLoading(false);
      }
    };
    fetchView();
  }, [slug]);

  const fetchComments = useCallback(async (creatorId: string) => {
    try {
      const res = await fetch(`/api/affiliates/comments?affiliate_creator_id=${creatorId}`);
      if (res.ok) {
        const list: AffiliateComment[] = await res.json();
        setComments(list);
        setCommentCounts((prev) => ({ ...prev, [creatorId]: list.length }));
      }
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    }
  }, []);

  const openComments = (id: string, handle: string) => {
    setCommentTarget({ id, handle });
    setEditingId(null);
    setDeletingId(null);
    fetchComments(id);
  };

  const submitComment = async () => {
    if (!commentTarget || !commentName.trim() || !commentContent.trim()) return;
    setSubmitting(true);
    setCommentError('');
    try {
      const res = await fetch('/api/affiliates/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliate_creator_id: commentTarget.id,
          author_name: commentName.trim(),
          content: commentContent.trim(),
        }),
      });
      if (res.ok) {
        const newComment = await res.json();
        saveMyCommentId(newComment.id);
        setMyCommentIds(getMyCommentIds());
        setCommentContent('');
        fetchComments(commentTarget.id);
      } else {
        const errData = await res.json();
        setCommentError(errData.error || 'Failed to submit comment');
      }
    } catch (err) {
      console.error('Failed to submit comment:', err);
      setCommentError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (comment: AffiliateComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
    setDeletingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const submitEdit = async (commentId: string) => {
    if (!editContent.trim() || !commentTarget) return;
    setEditSubmitting(true);
    try {
      const res = await fetch('/api/affiliates/comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId, content: editContent.trim() }),
      });
      if (res.ok) {
        setEditingId(null);
        setEditContent('');
        fetchComments(commentTarget.id);
      }
    } catch (err) {
      console.error('Failed to edit comment:', err);
    } finally {
      setEditSubmitting(false);
    }
  };

  const confirmDelete = (commentId: string) => {
    setDeletingId(commentId);
    setEditingId(null);
  };

  const submitDelete = async (commentId: string) => {
    if (!commentTarget) return;
    try {
      const res = await fetch(`/api/affiliates/comments?id=${commentId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        removeMyCommentId(commentId);
        setMyCommentIds(getMyCommentIds());
        setDeletingId(null);
        fetchComments(commentTarget.id);
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const CONFIRMATION_OPTIONS = [
    { value: 'Yes', color: '#22c55e' },
    { value: 'No', color: '#ef4444' },
    { value: 'Hold', color: '#f59e0b' },
  ];

  const handleConfirmationChange = async (id: string, value: string | null) => {
    if (!viewData) return;
    setViewData(prev => prev ? {
      ...prev,
      data: prev.data.map(row => row.id === id ? { ...row, confirmation_status: value } : row),
    } : prev);

    try {
      const res = await fetch('/api/affiliates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, confirmation_status: value }),
      });
      if (!res.ok) {
        // Revert
        const res2 = await fetch(`/api/affiliates/views/${slug}`);
        const json = await res2.json();
        setViewData(json);
      }
    } catch {
      const res2 = await fetch(`/api/affiliates/views/${slug}`);
      const json = await res2.json();
      setViewData(json);
    }
  };

  const getColumnLabel = (key: string) => {
    return FIXED_COLUMNS.find((c) => c.key === key)?.label || key;
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    const col = FIXED_COLUMNS.find((c) => c.key === key);
    if (col?.type === 'number' || col?.type === 'computed') {
      const n = Number(value);
      if (isNaN(n)) return String(value);
      return Math.round(n).toLocaleString();
    }
    return String(value);
  };

  const formatRelativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error || !viewData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-700">{error || 'View not found'}</p>
          <p className="text-sm text-gray-500 mt-1">This view may have been deleted or the link is invalid.</p>
        </div>
      </div>
    );
  }

  const { view, data } = viewData;
  const HIDDEN_IN_SHARED = ['brand_id', 'project_id', 'status', 'contact_type', 'tier', 'max_price', 'min_price'];
  const columns = (view.visible_columns.length > 0
    ? view.visible_columns
    : Object.keys(data[0] || {}).filter((k) => !['id', 'custom_data', 'created_at', 'updated_at'].includes(k))
  ).filter((k) => !HIDDEN_IN_SHARED.includes(k));

  const totalPlannedVideos = data.reduce((sum, row) => sum + (Number(row.planned_video_count) || 0), 0);
  const totalContractAmount = data.reduce((sum, row) => sum + (Number(row.contract_amount) || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg overflow-hidden bg-black">
            <Image src="/logo.png" alt="ALLSALE" width={32} height={32} className="object-cover" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{view.name}</h1>
            <p className="text-xs text-gray-500">{data.length} creators</p>
          </div>
        </div>
      </header>

      {/* Table */}
      <div className="max-w-[1400px] mx-auto p-6">
        <div className="bg-white rounded-lg border shadow-sm overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-sm">
              <tr className="border-b">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap"
                  >
                    {getColumnLabel(col)}
                  </th>
                ))}
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.id || i} className="border-b hover:bg-gray-50/50 transition-colors">
                  {columns.map((col) => (
                    <td key={col} className="px-4 py-2.5 whitespace-nowrap">
                      {col === 'handle' ? (
                        <a
                          href={`https://www.tiktok.com/@${String(row[col]).replace(/^@+/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium inline-flex items-center gap-1"
                        >
                          @{String(row[col]).replace(/^@+/, '')}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </a>
                      ) : col === 'confirmation_status' ? (
                        <div className="flex gap-1">
                          {CONFIRMATION_OPTIONS.map(opt => {
                            const current = row[col] as string | null;
                            const isActive = current === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => handleConfirmationChange(row.id, isActive ? null : opt.value)}
                                className="px-2 py-0.5 rounded text-xs font-medium transition-colors border"
                                style={isActive
                                  ? { backgroundColor: opt.color, color: 'white', borderColor: 'transparent' }
                                  : { color: '#9ca3af', borderColor: '#e5e7eb' }}
                              >
                                {opt.value}
                              </button>
                            );
                          })}
                        </div>
                      ) : col === 'thread' && row[col] ? (
                        <a
                          href={row[col]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          Link <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className={!row[col] && row[col] !== 0 ? 'text-gray-300' : ''}>
                          {formatValue(col, row[col])}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2.5">
                    {(() => {
                      const count = commentCounts[row.id] || 0;
                      const hasComments = count > 0;
                      return (
                        <button
                          onClick={() => openComments(row.id, row.handle)}
                          className={`relative flex items-center gap-1 px-1.5 py-1 rounded transition-colors ${
                            hasComments
                              ? 'text-indigo-600 hover:bg-indigo-50'
                              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                          }`}
                          title={hasComments ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment'}
                        >
                          <MessageSquare className={`h-4 w-4 ${hasComments ? 'fill-indigo-100' : ''}`} />
                          {hasComments && (
                            <span className="min-w-[16px] text-center text-xs font-semibold leading-none">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-gray-400">
                    No data in this view.
                  </td>
                </tr>
              )}
            </tbody>
            {data.length > 0 && (
              <tfoot className="bg-gray-50 border-t-2">
                <tr>
                  {columns.map((col) => (
                    <td key={col} className="px-4 py-3 whitespace-nowrap font-semibold text-sm">
                      {col === 'planned_video_count' ? totalPlannedVideos.toLocaleString()
                        : col === 'contract_amount' ? `$${totalContractAmount.toLocaleString()}`
                        : col === 'handle' ? 'Total'
                        : ''}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Comments Panel */}
      {commentTarget && (
        <div className="fixed inset-y-0 right-0 w-80 bg-white border-l shadow-lg z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-medium text-sm">@{commentTarget.handle.replace(/^@+/, '')}</h3>
            <button
              onClick={() => { setCommentTarget(null); setEditingId(null); setDeletingId(null); }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {comments.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No comments yet</p>
            )}
            {comments.map((c) => {
              const isMine = myCommentIds.has(c.id);
              const isEditing = editingId === c.id;
              const isConfirmingDelete = deletingId === c.id;

              return (
                <div key={c.id} className="bg-gray-50 rounded-lg p-3 group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{c.author_name}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{formatRelativeTime(c.created_at)}</span>
                      {isMine && !isEditing && !isConfirmingDelete && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                          <button
                            onClick={() => startEdit(c)}
                            className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => confirmDelete(c.id)}
                            className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Editing mode */}
                  {isEditing ? (
                    <div className="space-y-1.5 mt-1">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(c.id); }
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="w-full text-sm border rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-gray-300"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={cancelEdit}
                          className="text-xs px-2 py-0.5 rounded border text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => submitEdit(c.id)}
                          disabled={editSubmitting || !editContent.trim()}
                          className="text-xs px-2 py-0.5 rounded bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          <Check className="h-3 w-3" />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : isConfirmingDelete ? (
                    /* Delete confirmation */
                    <div className="mt-1.5 space-y-1.5">
                      <p className="text-xs text-red-600">Delete this comment?</p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setDeletingId(null)}
                          className="text-xs px-2 py-0.5 rounded border text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => submitDelete(c.id)}
                          className="text-xs px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700">{c.content}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t p-4 space-y-2">
            <Input
              placeholder="Your name"
              value={commentName}
              onChange={(e) => setCommentName(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Write a comment..."
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={submitComment}
                disabled={submitting || !commentName.trim() || !commentContent.trim()}
              >
                <Send className="h-3 w-3" />
              </Button>
            </div>
            {commentError && (
              <p className="text-xs text-red-500">{commentError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
