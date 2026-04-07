'use client';

import { useState, useEffect, useCallback } from 'react';

export interface FavoriteProject {
  id: string;
  name: string;
  brandSlug: string;
  brandName: string;
}

const STORAGE_KEY = 'favoriteProjects';

export function useFavoriteProjects() {
  const [favorites, setFavorites] = useState<FavoriteProject[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const toggleFavorite = useCallback((project: FavoriteProject) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === project.id);
      const next = exists
        ? prev.filter((f) => f.id !== project.id)
        : [...prev, project];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (projectId: string) => favorites.some((f) => f.id === projectId),
    [favorites]
  );

  return { favorites, toggleFavorite, isFavorite };
}
