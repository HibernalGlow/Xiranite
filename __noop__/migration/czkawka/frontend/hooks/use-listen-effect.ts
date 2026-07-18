import { listen } from '@/nodes/czkawka/upstream/adapters/tauri-event';
import { useEffect, useRef } from 'react';

export function useListenEffect<T>(name: string, fn: (v: T) => void) {
  const lock = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (lock.current) {
      return;
    }
    listen<T>(name, (e) => {
      fnRef.current(e.payload);
    });
    lock.current = true;
  }, []);
}
