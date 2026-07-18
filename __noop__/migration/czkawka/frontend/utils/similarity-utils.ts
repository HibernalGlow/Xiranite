/**
 * 相似度工具函数
 * 基于 czkawka_core 的相似度计算逻辑
 */

// 相似度阈值表，对应不同哈希大小的阈值
// [VeryHigh, High, Medium, Small, VerySmall, Minimal]
const SIMILAR_VALUES: number[][] = [
  [1, 2, 5, 7, 14, 40], // 8-bit hash
  [2, 5, 15, 30, 40, 40], // 16-bit hash
  [4, 10, 20, 40, 40, 40], // 32-bit hash
  [6, 20, 40, 40, 40, 40], // 64-bit hash
];

export enum SimilarityLevel {
  Original = 'Original',
  VeryHigh = 'VeryHigh',
  High = 'High',
  Medium = 'Medium',
  Small = 'Small',
  VerySmall = 'VerySmall',
  Minimal = 'Minimal',
}

/**
 * 根据哈希大小获取阈值数组索引
 */
function getHashSizeIndex(hashSize: number): number {
  switch (hashSize) {
    case 8:
      return 0;
    case 16:
      return 1;
    case 32:
      return 2;
    case 64:
      return 3;
    default:
      return 1; // 默认使用16-bit
  }
}

/**
 * 根据相似度数值和哈希大小确定相似度级别
 */
export function getSimilarityLevel(
  similarity: number,
  hashSize: number,
): SimilarityLevel {
  if (similarity === 0) {
    return SimilarityLevel.Original;
  }

  const index = getHashSizeIndex(hashSize);
  const thresholds = SIMILAR_VALUES[index];

  if (similarity <= thresholds[0]) {
    return SimilarityLevel.VeryHigh;
  }
  if (similarity <= thresholds[1]) {
    return SimilarityLevel.High;
  }
  if (similarity <= thresholds[2]) {
    return SimilarityLevel.Medium;
  }
  if (similarity <= thresholds[3]) {
    return SimilarityLevel.Small;
  }
  if (similarity <= thresholds[4]) {
    return SimilarityLevel.VerySmall;
  }
  if (similarity <= thresholds[5]) {
    return SimilarityLevel.Minimal;
  }
  return SimilarityLevel.Minimal; // 超出范围的归为最低级别
}

/**
 * 获取相似度级别的显示文本
 */
export function getSimilarityLevelText(level: SimilarityLevel): string {
  switch (level) {
    case SimilarityLevel.Original:
      return 'Original';
    case SimilarityLevel.VeryHigh:
      return 'Very High';
    case SimilarityLevel.High:
      return 'High';
    case SimilarityLevel.Medium:
      return 'Medium';
    case SimilarityLevel.Small:
      return 'Small';
    case SimilarityLevel.VerySmall:
      return 'Very Small';
    case SimilarityLevel.Minimal:
      return 'Minimal';
  }
}

/**
 * 获取相似度级别的颜色类名
 */
export function getSimilarityLevelColor(level: SimilarityLevel): string {
  switch (level) {
    case SimilarityLevel.Original:
      return 'text-purple-600 bg-purple-50';
    case SimilarityLevel.VeryHigh:
      return 'text-red-600 bg-red-50';
    case SimilarityLevel.High:
      return 'text-orange-600 bg-orange-50';
    case SimilarityLevel.Medium:
      return 'text-yellow-600 bg-yellow-50';
    case SimilarityLevel.Small:
      return 'text-blue-600 bg-blue-50';
    case SimilarityLevel.VerySmall:
      return 'text-green-600 bg-green-50';
    case SimilarityLevel.Minimal:
      return 'text-gray-600 bg-gray-50';
  }
}

/**
 * 获取相似度级别对应的数值范围
 */
export function getSimilarityRange(
  level: SimilarityLevel,
  hashSize: number,
): string {
  if (level === SimilarityLevel.Original) {
    return '= 0';
  }

  const index = getHashSizeIndex(hashSize);
  const thresholds = SIMILAR_VALUES[index];

  switch (level) {
    case SimilarityLevel.VeryHigh:
      return `≤ ${thresholds[0]}`;
    case SimilarityLevel.High:
      return `≤ ${thresholds[1]}`;
    case SimilarityLevel.Medium:
      return `≤ ${thresholds[2]}`;
    case SimilarityLevel.Small:
      return `≤ ${thresholds[3]}`;
    case SimilarityLevel.VerySmall:
      return `≤ ${thresholds[4]}`;
    case SimilarityLevel.Minimal:
      return `≤ ${thresholds[5]}`;
    default:
      return '';
  }
}

/**
 * 格式化相似度显示文本，显示数值和对应的级别范围
 */
export function formatSimilarityDisplay(
  similarity: string,
  hashSize: number,
): string {
  const similarityNum = Number.parseInt(similarity, 10);
  if (Number.isNaN(similarityNum)) {
    return similarity;
  }

  const level = getSimilarityLevel(similarityNum, hashSize);
  const levelText = getSimilarityLevelText(level);
  const range = getSimilarityRange(level, hashSize);

  return `${similarity} (${levelText} ${range})`;
}

/**
 * 获取所有相似度级别及其对应的数值范围
 */
export function getAllSimilarityLevelsWithRanges(hashSize: number): Array<{
  level: SimilarityLevel;
  text: string;
  range: string;
  displayText: string;
}> {
  const levels = [
    SimilarityLevel.Original,
    SimilarityLevel.VeryHigh,
    SimilarityLevel.High,
    SimilarityLevel.Medium,
    SimilarityLevel.Small,
    SimilarityLevel.VerySmall,
    SimilarityLevel.Minimal,
  ];

  return levels.map((level) => {
    const text = getSimilarityLevelText(level);
    const range = getSimilarityRange(level, hashSize);
    return {
      level,
      text,
      range,
      displayText: `${text} (${range})`,
    };
  });
}

/**
 * 检查相似度是否满足筛选条件
 */
export function matchesSimilarityFilter(
  similarity: string,
  hashSize: number,
  filterLevel: SimilarityLevel | null,
  filterOperator: 'gte' | 'lte' | 'eq' = 'gte',
): boolean {
  if (!filterLevel) return true;

  const similarityNum = Number.parseInt(similarity, 10);
  if (Number.isNaN(similarityNum)) return true;

  const currentLevel = getSimilarityLevel(similarityNum, hashSize);
  const levelOrder = [
    SimilarityLevel.Original,
    SimilarityLevel.VeryHigh,
    SimilarityLevel.High,
    SimilarityLevel.Medium,
    SimilarityLevel.Small,
    SimilarityLevel.VerySmall,
    SimilarityLevel.Minimal,
  ];

  const currentIndex = levelOrder.indexOf(currentLevel);
  const filterIndex = levelOrder.indexOf(filterLevel);

  switch (filterOperator) {
    case 'gte':
      return currentIndex <= filterIndex; // 更高或相等的相似度
    case 'lte':
      return currentIndex >= filterIndex; // 更低或相等的相似度
    case 'eq':
      return currentIndex === filterIndex; // 完全相等
    default:
      return true;
  }
}
