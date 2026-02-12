"use client";
import { useEffect, useState } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  // Initialize from localStorage synchronously to avoid default flash
  const [value, setValue] = useState<T>(() => {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(key);
        if (raw != null) return JSON.parse(raw);
      }
    } catch {}
    return initialValue;
  });

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (raw != null) {
        setValue(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value));
        // Dispatch a custom event for same-tab listeners
        const evt = new CustomEvent('localstorage:set', { detail: { key, value } });
        window.dispatchEvent(evt);
      }
    } catch {
      // ignore
    }
  }, [key, value]);

  // Listen for changes to the same key from other components or tabs
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === key && e.newValue != null) {
        try { setValue(JSON.parse(e.newValue)); } catch {}
      }
    }
    function onCustom(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d && d.key === key) {
        setValue(d.value as T);
      }
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('localstorage:set', onCustom as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('localstorage:set', onCustom as EventListener);
    };
  }, [key]);

  return [value, setValue] as const;
}
