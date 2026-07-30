import content from './legal-jurisdiction.json';

export type AccentName = keyof Pick<
  typeof content.palette,
  'red' | 'teal' | 'gold'
>;

export type LegalRow = (typeof content.rows)[number];

export type CellGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RowGeometry = {
  readonly section?: CellGeometry;
  readonly relation?: CellGeometry;
  readonly content: CellGeometry;
  readonly focus: CellGeometry;
};

const [sectionWidth, relationWidth, contentWidth] = content.table.columnWidths;
const [conceptHeight, scopeHeight, mediationHeight, arbitrationHeight, laborHeight] =
  content.table.rowHeights;

const rowTops = content.table.rowHeights.reduce<number[]>(
  (tops, height) => [...tops, tops[tops.length - 1] + height],
  [content.table.y],
);

const fullContentWidth = relationWidth + contentWidth;
const relationshipHeight = mediationHeight + arbitrationHeight + laborHeight;

export const rowGeometry: readonly RowGeometry[] = [
  {
    section: {
      x: content.table.x,
      y: rowTops[0],
      width: sectionWidth,
      height: conceptHeight,
    },
    content: {
      x: content.table.x + sectionWidth,
      y: rowTops[0],
      width: fullContentWidth,
      height: conceptHeight,
    },
    focus: {
      x: content.table.x,
      y: rowTops[0],
      width: content.table.width,
      height: conceptHeight,
    },
  },
  {
    section: {
      x: content.table.x,
      y: rowTops[1],
      width: sectionWidth,
      height: scopeHeight,
    },
    content: {
      x: content.table.x + sectionWidth,
      y: rowTops[1],
      width: fullContentWidth,
      height: scopeHeight,
    },
    focus: {
      x: content.table.x,
      y: rowTops[1],
      width: content.table.width,
      height: scopeHeight,
    },
  },
  {
    section: {
      x: content.table.x,
      y: rowTops[2],
      width: sectionWidth,
      height: relationshipHeight,
    },
    relation: {
      x: content.table.x + sectionWidth,
      y: rowTops[2],
      width: relationWidth,
      height: mediationHeight,
    },
    content: {
      x: content.table.x + sectionWidth + relationWidth,
      y: rowTops[2],
      width: contentWidth,
      height: mediationHeight,
    },
    focus: {
      x: content.table.x + sectionWidth,
      y: rowTops[2],
      width: fullContentWidth,
      height: mediationHeight,
    },
  },
  {
    relation: {
      x: content.table.x + sectionWidth,
      y: rowTops[3],
      width: relationWidth,
      height: arbitrationHeight,
    },
    content: {
      x: content.table.x + sectionWidth + relationWidth,
      y: rowTops[3],
      width: contentWidth,
      height: arbitrationHeight,
    },
    focus: {
      x: content.table.x + sectionWidth,
      y: rowTops[3],
      width: fullContentWidth,
      height: arbitrationHeight,
    },
  },
  {
    relation: {
      x: content.table.x + sectionWidth,
      y: rowTops[4],
      width: relationWidth,
      height: laborHeight,
    },
    content: {
      x: content.table.x + sectionWidth + relationWidth,
      y: rowTops[4],
      width: contentWidth,
      height: laborHeight,
    },
    focus: {
      x: content.table.x + sectionWidth,
      y: rowTops[4],
      width: fullContentWidth,
      height: laborHeight,
    },
  },
];

export const tableBottom =
  content.table.y + content.table.rowHeights.reduce((sum, height) => sum + height, 0);

export default content;
