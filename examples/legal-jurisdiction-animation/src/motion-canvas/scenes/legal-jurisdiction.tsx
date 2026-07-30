/** @jsxImportSource @motion-canvas/2d/lib */
import {Node, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {
  all,
  createRef,
  easeOutCubic,
  makeRef,
  waitFor,
} from '@motion-canvas/core';
import content, {
  type AccentName,
  type CellGeometry,
  rowGeometry,
  tableBottom,
} from '../../shared/layout';

const FONT_FAMILY = 'Microsoft YaHei, PingFang SC, sans-serif';
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

const scenePosition = (geometry: CellGeometry) => ({
  x: geometry.x + geometry.width / 2 - FRAME_WIDTH / 2,
  y: geometry.y + geometry.height / 2 - FRAME_HEIGHT / 2,
});

const accentColor = (accent: AccentName) => content.palette[accent];

const softAccentColor = (accent: AccentName) => {
  if (accent === 'red') return content.palette.softRed;
  if (accent === 'teal') return content.palette.softTeal;
  return content.palette.softGold;
};

const bodyFontSize = (key: string) => {
  if (key === 'mediation') return 24;
  if (key === 'arbitration') return 27;
  return 32;
};

export default makeScene2D(function* (view) {
  view.fill(content.palette.background);

  const headerAccent = createRef<Rect>();
  const titleGroup = createRef<Node>();
  const footer = createRef<Node>();
  const rowGroups: Node[] = [];
  const focusOutlines: Rect[] = [];

  view.add(
    <>
      <Rect
        ref={headerAccent}
        x={106 - FRAME_WIDTH / 2}
        y={110 - FRAME_HEIGHT / 2}
        width={12}
        height={104}
        fill={content.palette.red}
        scaleY={0}
      />
      <Node ref={titleGroup} x={0} y={20} opacity={0}>
        <Txt
          x={140 - FRAME_WIDTH / 2}
          y={70 - FRAME_HEIGHT / 2}
          offset={[-1, -1]}
          text={content.eyebrow}
          fontFamily={FONT_FAMILY}
          fontSize={20}
          fontWeight={700}
          fill={content.palette.red}
        />
        <Txt
          x={140 - FRAME_WIDTH / 2}
          y={92 - FRAME_HEIGHT / 2}
          offset={[-1, -1]}
          text={content.title}
          fontFamily={FONT_FAMILY}
          fontSize={72}
          fontWeight={800}
          fill={content.palette.ink}
        />
        <Txt
          x={FRAME_WIDTH / 2 - 100}
          y={84 - FRAME_HEIGHT / 2}
          offset={[1, -1]}
          text={content.folio}
          fontFamily={'Arial, sans-serif'}
          fontSize={20}
          fontWeight={700}
          fill={content.palette.muted}
        />
      </Node>

      {content.rows.map((row, index) => {
        const geometry = rowGeometry[index];
        const accent = row.accent as AccentName;

        return (
          <Node ref={makeRef(rowGroups, index)} x={-30} opacity={0}>
            {geometry.section ? (
              <Rect
                {...scenePosition(geometry.section)}
                width={geometry.section.width}
                height={geometry.section.height}
                fill={softAccentColor(accent)}
                stroke={content.palette.line}
                lineWidth={2}
                layout
                alignItems={'center'}
                justifyContent={'center'}
                padding={22}
              >
                <Rect
                  width={10}
                  height={10}
                  marginRight={12}
                  fill={accentColor(accent)}
                />
                <Txt
                  text={row.section}
                  textWrap={'pre'}
                  textAlign={'center'}
                  fontFamily={FONT_FAMILY}
                  fontSize={index === 2 ? 20 : 30}
                  fontWeight={700}
                  lineHeight={index === 2 ? 32 : 42}
                  fill={content.palette.ink}
                />
              </Rect>
            ) : null}
            {geometry.relation ? (
              <Rect
                {...scenePosition(geometry.relation)}
                width={geometry.relation.width}
                height={geometry.relation.height}
                fill={softAccentColor(accent)}
                stroke={content.palette.line}
                lineWidth={2}
                layout
                alignItems={'center'}
                justifyContent={'center'}
                padding={22}
              >
                <Rect
                  width={10}
                  height={10}
                  marginRight={12}
                  fill={accentColor(accent)}
                />
                <Txt
                  text={row.relation}
                  textAlign={'center'}
                  fontFamily={FONT_FAMILY}
                  fontSize={30}
                  fontWeight={700}
                  fill={content.palette.ink}
                />
              </Rect>
            ) : null}
            <Rect
              {...scenePosition(geometry.content)}
              width={geometry.content.width}
              height={geometry.content.height}
              fill={content.palette.paper}
              stroke={content.palette.line}
              lineWidth={2}
              layout
              direction={'column'}
              alignItems={'start'}
              justifyContent={'center'}
              padding={[20, 28]}
            >
              <Txt
                text={row.lines.join('\n')}
                textWrap={'pre'}
                textAlign={'left'}
                fontFamily={FONT_FAMILY}
                fontSize={bodyFontSize(row.key)}
                fontWeight={row.key === 'concept' ? 700 : 500}
                lineHeight={row.key === 'mediation' ? 35 : 46}
                fill={content.palette.ink}
              />
            </Rect>
          </Node>
        );
      })}

      {content.rows.map((row, index) => {
        const geometry = rowGeometry[index].focus;
        const accent = row.accent as AccentName;

        return (
          <Rect
            ref={makeRef(focusOutlines, index)}
            {...scenePosition(geometry)}
            width={geometry.width}
            height={geometry.height}
            fill={null}
            stroke={accentColor(accent)}
            lineWidth={6}
            opacity={0}
          />
        );
      })}

      <Node ref={footer} opacity={0}>
        <Rect
          x={142 - FRAME_WIDTH / 2}
          y={tableBottom + 36 - FRAME_HEIGHT / 2}
          width={84}
          height={4}
          fill={content.palette.ink}
        />
        <Txt
          x={206 - FRAME_WIDTH / 2}
          y={tableBottom + 24 - FRAME_HEIGHT / 2}
          offset={[-1, -1]}
          text={'主管 · 人民调解 · 仲裁 · 劳动仲裁'}
          fontFamily={FONT_FAMILY}
          fontSize={24}
          fontWeight={700}
          fill={content.palette.muted}
        />
      </Node>
    </>,
  );

  yield* all(
    headerAccent().scale.y(1, 0.7, easeOutCubic),
    titleGroup().opacity(1, 0.8, easeOutCubic),
    titleGroup().position.y(0, 0.8, easeOutCubic),
  );
  yield* waitFor(content.rowStarts[0] - 0.8);

  for (let index = 0; index < rowGroups.length; index += 1) {
    const start = content.rowStarts[index];
    const nextStart = content.rowStarts[index + 1] ?? 14.5;
    const animations = [
      rowGroups[index].opacity(1, 0.55, easeOutCubic),
      rowGroups[index].position.x(0, 0.55, easeOutCubic),
      focusOutlines[index].opacity(1, 0.3, easeOutCubic),
    ];

    if (index > 0) {
      animations.push(focusOutlines[index - 1].opacity(0, 0.3, easeOutCubic));
    }

    yield* all(...animations);
    yield* waitFor(Math.max(0, nextStart - start - 0.55));
  }

  yield* all(
    focusOutlines[focusOutlines.length - 1].opacity(0, 0.35, easeOutCubic),
    footer().opacity(1, 0.5, easeOutCubic),
  );
  yield* waitFor(content.durationSeconds - 15);
});
