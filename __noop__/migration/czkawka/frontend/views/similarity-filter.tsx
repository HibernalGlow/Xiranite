import { Filter, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import {
  getAllSimilarityLevelsWithRanges,
  type SimilarityLevel,
} from '@/nodes/czkawka/upstream/utils/similarity-utils';

interface SimilarityFilterProps {
  onFilterChange: (
    level: SimilarityLevel | null,
    operator: 'gte' | 'lte' | 'eq',
  ) => void;
  currentFilter: {
    level: SimilarityLevel | null;
    operator: 'gte' | 'lte' | 'eq';
  };
  hashSize: number;
}

export function SimilarityFilter({
  onFilterChange,
  currentFilter,
  hashSize,
}: SimilarityFilterProps) {
  const t = useT();
  const [tempLevel, setTempLevel] = useState<SimilarityLevel | null>(
    currentFilter.level,
  );
  const [tempOperator, setTempOperator] = useState<'gte' | 'lte' | 'eq'>(
    currentFilter.operator,
  );

  const handleApplyFilter = () => {
    onFilterChange(tempLevel, tempOperator);
  };

  const handleClearFilter = () => {
    setTempLevel(null);
    setTempOperator('gte');
    onFilterChange(null, 'gte');
  };

  // 获取当前哈希大小对应的相似度级别和范围
  const similarityLevelsWithRanges = getAllSimilarityLevelsWithRanges(hashSize);

  const operators = [
    { value: 'gte' as const, label: t('Greater than or equal') },
    { value: 'lte' as const, label: t('Less than or equal') },
    { value: 'eq' as const, label: t('Equal to') },
  ];

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            {t('Similarity filter')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>{t('Filter by similarity')}</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('Operator')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={tempOperator}
            onValueChange={(value) => setTempOperator(value as any)}
          >
            {operators.map((op) => (
              <DropdownMenuRadioItem key={op.value} value={op.value}>
                {op.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('Similarity level')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={tempLevel || ''}
            onValueChange={(value) =>
              setTempLevel((value as SimilarityLevel) || null)
            }
          >
            <DropdownMenuRadioItem value="">
              {t('All levels')}
            </DropdownMenuRadioItem>
            {similarityLevelsWithRanges.map((item) => (
              <DropdownMenuRadioItem key={item.level} value={item.level}>
                {item.displayText}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <div className="flex gap-2 p-2">
            <Button size="sm" onClick={handleApplyFilter} className="flex-1">
              {t('Apply')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearFilter}
              className="flex-1"
            >
              {t('Clear')}
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {currentFilter.level && (
        <Badge variant="secondary" className="flex items-center gap-1">
          {similarityLevelsWithRanges.find(
            (item) => item.level === currentFilter.level,
          )?.displayText || currentFilter.level}
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 hover:bg-transparent"
            onClick={handleClearFilter}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      )}
    </div>
  );
}
