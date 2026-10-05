// packages/nodes/linedup/src/core.ts
function normalizeLine(line) {
  return line.trim();
}
function uniqueNonEmptyLines(lines) {
  return [...new Set(lines.map(normalizeLine).filter(Boolean))];
}
function filterLines(input) {
  const source = uniqueNonEmptyLines(input.sourceLines);
  const filters = uniqueNonEmptyLines(input.filterLines);
  const caseSensitive = input.caseSensitive ?? true;
  const normalizeCompare = (value) => caseSensitive ? value : value.toLowerCase();
  const compareFilters = filters.map(normalizeCompare);
  const filteredLines = [];
  const removedLines = [];
  for (const line of source) {
    const comparableLine = normalizeCompare(line);
    const shouldRemove = compareFilters.some((filter) => filter.length > 0 && comparableLine.includes(filter));
    if (shouldRemove) {
      removedLines.push(line);
    } else {
      filteredLines.push(line);
    }
  }
  const sortedFiltered = input.sort === false ? filteredLines : [...filteredLines].sort(localeSort);
  const sortedRemoved = input.sort === false ? removedLines : [...removedLines].sort(localeSort);
  return {
    filteredLines: sortedFiltered,
    removedLines: sortedRemoved,
    removedCount: sortedRemoved.length,
    keptCount: sortedFiltered.length
  };
}
function localeSort(a, b) {
  return a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" });
}
export {
  filterLines
};
