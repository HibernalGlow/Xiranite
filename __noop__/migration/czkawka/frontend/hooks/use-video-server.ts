import { invoke } from '@/nodes/czkawka/upstream/adapters/tauri-core';
import { useEffect, useState } from 'react';

// Use a global promise to share the port request across components
let portPromise: Promise<number> | null = null;

function getPort() {
  if (!portPromise) {
    portPromise = invoke<number>('get_video_server_port');
  }
  return portPromise;
}

export function useVideoServer() {
  const [port, setPort] = useState<number | null>(null);

  useEffect(() => {
    getPort()
      .then((p) => {
        console.log('[useVideoServer] Got port:', p);
        setPort(p);
      })
      .catch((err) => {
        console.error('[useVideoServer] Failed to get video server port', err);
      });
  }, []);

  const getVideoUrl = (path: string) => {
    if (!port || !path) return undefined;

    // Check if we already have the correct URL format (starts with http://127.0.0.1)
    if (
      path.startsWith('http://127.0.0.1') ||
      path.startsWith('http://localhost')
    ) {
      return path;
    }

    return `http://127.0.0.1:${port}/video?path=${encodeURIComponent(path)}`;
  };

  return { port, getVideoUrl };
}
