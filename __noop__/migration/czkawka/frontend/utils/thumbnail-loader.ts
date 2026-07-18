import { ipc } from '@/nodes/czkawka/upstream/ipc';

// 全局缩略图加载队列管理器
export class ThumbnailLoader {
  private static instance: ThumbnailLoader;
  private queue: Array<{
    path: string;
    resolve: (data: string) => void;
    reject: (error: Error) => void;
    aborted: boolean;
  }> = [];
  private processing = new Set<string>();
  private cache = new Map<string, string>();
  private readonly maxConcurrent = 3; // 最大并发数
  private loadingCount = 0;

  static getInstance() {
    if (!ThumbnailLoader.instance) {
      ThumbnailLoader.instance = new ThumbnailLoader();
    }
    return ThumbnailLoader.instance;
  }

  async loadThumbnail(path: string): Promise<string> {
    // 检查缓存
    if (this.cache.has(path)) {
      const cached = this.cache.get(path);
      if (cached) {
        return cached;
      }
    }

    // 如果正在处理，返回现有的Promise
    if (this.processing.has(path)) {
      return new Promise((resolve, reject) => {
        this.queue.push({ path, resolve, reject, aborted: false });
      });
    }

    // 优先检查后端是否已有缓存的缩略图
    try {
      const hasCached = await ipc.hasThumbnail(path);
      if (hasCached) {
        // 直接加载缓存的缩略图，无需排队
        return this.loadCachedThumbnail(path);
      }
    } catch (error) {
      console.warn('Failed to check thumbnail cache for', path, error);
    }

    return new Promise((resolve, reject) => {
      const task = { path, resolve, reject, aborted: false };
      this.queue.push(task);
      this.processQueue();
    });
  }

  private async loadCachedThumbnail(path: string): Promise<string> {
    const result = await ipc.readThumbnail(path);
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;

    // 缓存结果
    this.cache.set(path, dataUrl);
    return dataUrl;
  }

  private async processQueue() {
    if (this.loadingCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task || task.aborted) {
      this.processQueue();
      return;
    }

    this.loadingCount++;
    this.processing.add(task.path);

    try {
      const result = await ipc.readThumbnail(task.path);
      const dataUrl = `data:${result.mimeType};base64,${result.base64}`;

      // 缓存结果
      this.cache.set(task.path, dataUrl);

      // 解决所有等待此路径的Promise
      const waitingTasks = this.queue.filter(
        (t) => t.path === task.path && !t.aborted,
      );
      for (const t of waitingTasks) {
        t.resolve(dataUrl);
        const index = this.queue.indexOf(t);
        if (index > -1) this.queue.splice(index, 1);
      }

      task.resolve(dataUrl);
    } catch (error) {
      task.reject(error as Error);
    } finally {
      this.loadingCount--;
      this.processing.delete(task.path);
      // 继续处理队列
      setTimeout(() => this.processQueue(), 0);
    }
  }

  abortRequest(path: string) {
    // 标记队列中的请求为已取消
    for (const task of this.queue) {
      if (task.path === path) {
        task.aborted = true;
      }
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheSize() {
    return this.cache.size;
  }

  getQueueSize() {
    return this.queue.length;
  }

  getProcessingCount() {
    return this.processing.size;
  }
}

// 检查是否是图片文件的工具函数
export function isImageFile(path: string): boolean {
  return !!path
    .toLowerCase()
    .match(/\.(jpg|jpeg|png|gif|bmp|webp|tiff|svg|jxl|avif)$/);
}
