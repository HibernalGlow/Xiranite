import { ipc } from '@/nodes/czkawka/upstream/ipc';
import { isImageFile } from './thumbnail-loader';

/**
 * 缩略图预加载器 - 在后台为图片预生成缩略图
 */
export class ThumbnailPreloader {
  private static instance: ThumbnailPreloader;
  private isRunning = false;
  private currentBatch: string[] = [];
  private readonly batchSize = 50; // 批次大小
  private readonly delayBetweenBatches = 1000; // 批次间延迟(ms)

  static getInstance() {
    if (!ThumbnailPreloader.instance) {
      ThumbnailPreloader.instance = new ThumbnailPreloader();
    }
    return ThumbnailPreloader.instance;
  }

  /**
   * 开始为图片列表预生成缩略图
   */
  async startPreloading(allPaths: string[]) {
    if (this.isRunning) {
      console.log('Thumbnail preloading already running');
      return;
    }

    // 过滤出图片文件
    const imagePaths = allPaths.filter((path) => isImageFile(path));
    if (imagePaths.length === 0) {
      console.log('No image files to preload');
      return;
    }

    console.log(
      `Starting thumbnail preloading for ${imagePaths.length} images`,
    );
    this.isRunning = true;

    try {
      // 首先检查哪些图片已经有缩略图了
      const pathsNeedingThumbnails =
        await this.filterPathsNeedingThumbnails(imagePaths);

      if (pathsNeedingThumbnails.length === 0) {
        console.log('All thumbnails already exist');
        return;
      }

      console.log(
        `${pathsNeedingThumbnails.length} images need thumbnail generation`,
      );

      // 分批处理
      for (let i = 0; i < pathsNeedingThumbnails.length; i += this.batchSize) {
        if (!this.isRunning) break; // 如果被停止了，退出循环

        const batch = pathsNeedingThumbnails.slice(i, i + this.batchSize);
        console.log(
          `Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(pathsNeedingThumbnails.length / this.batchSize)}: ${batch.length} images`,
        );

        try {
          await ipc.batchGenerateThumbnails(batch);
        } catch (error) {
          console.error('Failed to generate batch thumbnails:', error);
        }

        // 批次间延迟，避免过度占用资源
        if (i + this.batchSize < pathsNeedingThumbnails.length) {
          await this.delay(this.delayBetweenBatches);
        }
      }

      console.log('Thumbnail preloading completed');
    } catch (error) {
      console.error('Thumbnail preloading failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 停止预加载
   */
  stop() {
    if (this.isRunning) {
      console.log('Stopping thumbnail preloading');
      this.isRunning = false;
    }
  }

  /**
   * 检查是否正在运行
   */
  isPreloading() {
    return this.isRunning;
  }

  /**
   * 过滤出需要生成缩略图的路径
   */
  private async filterPathsNeedingThumbnails(
    paths: string[],
  ): Promise<string[]> {
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        try {
          const hasThumbnail = await ipc.hasThumbnail(path);
          return { path, needsThumbnail: !hasThumbnail };
        } catch {
          return { path, needsThumbnail: true }; // 如果检查失败，假设需要生成
        }
      }),
    );

    return results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          path: string;
          needsThumbnail: boolean;
        }> => result.status === 'fulfilled',
      )
      .filter((result) => result.value.needsThumbnail)
      .map((result) => result.value.path);
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
