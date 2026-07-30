import type {LucideIcon} from 'lucide-react';
import {
  BadgeX,
  BriefcaseBusiness,
  FileCheck2,
  FileText,
  Gavel,
  Handshake,
  Landmark,
  Scale,
  ShieldCheck,
  Stamp,
} from 'lucide-react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import {accentColor, accentSoftColor, PALETTE, toSourceFrame, type Accent} from '../storyboard';
import {
  baseTextStyle,
  CourtNode,
  ENTER_EASING,
  FlowArrow,
  IconNode,
  ImpactReveal,
  Keyword,
  MaskedReveal,
  SceneHeading,
} from '../visual-system';

export const MediationScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const agreementProgress = interpolate(frame, [34, 94], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const branchProgress = interpolate(frame, [92, 136], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });
  const stampProgress = interpolate(frame, [158, 184], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });
  const resultProgress = interpolate(frame, [220, 256], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });
  const impact = interpolate(frame, [182, 190, 204], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="04" eyebrow="与人民调解" title="确认前后，执行力改变" accent="gold" />

      <MaskedReveal delay={18} duration={26} style={{position: 'absolute', left: 112, top: 424}}>
        <IconNode icon={Handshake} label="调解协议" detail="当事人达成" accent="gold" />
      </MaskedReveal>

      <FlowArrow left={450} top={468} width={365} progress={agreementProgress} accent="gold" />

      <div
        style={{
          position: 'absolute',
          left: 828,
          top: 294,
          width: 430,
          height: 440,
          boxSizing: 'border-box',
          padding: '40px 44px',
          backgroundColor: PALETTE.paper,
          border: `2px solid ${PALETTE.gold}`,
          borderRadius: 8,
          boxShadow: `0 18px 44px rgba(23, 32, 29, ${0.09 + impact * 0.08})`,
          translate: `0px ${impact * 9}px`,
        }}
      >
        <FileCheck2 size={66} color={PALETTE.gold} strokeWidth={2} />
        <div style={{...baseTextStyle, marginTop: 24, fontSize: 35, fontWeight: 900}}>调解协议</div>
        <div style={{marginTop: 28, height: 2, backgroundColor: PALETTE.line}} />
        <div style={{...baseTextStyle, marginTop: 24, color: PALETTE.teal, fontSize: 27, fontWeight: 850}}>有合同约束力</div>
        <div style={{...baseTextStyle, display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, color: PALETTE.red, fontSize: 24, fontWeight: 800}}>
          <BadgeX size={30} />
          无强制执行力
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 680,
          top: 688,
          width: 120,
          height: 126,
          borderLeft: `4px solid ${PALETTE.gold}`,
          borderBottom: `4px solid ${PALETTE.gold}`,
          scale: `${branchProgress} ${branchProgress}`,
          transformOrigin: 'right top',
        }}
      />
      <ImpactReveal delay={128} style={{position: 'absolute', left: 300, top: 734}}>
        <div style={{...baseTextStyle, display: 'flex', alignItems: 'center', gap: 18, fontSize: 28, fontWeight: 850}}>
          <Gavel size={42} color={PALETTE.gold} />
          履行或内容有争议：<Keyword accent="gold">可起诉</Keyword>
        </div>
      </ImpactReveal>

      <div
        style={{
          position: 'absolute',
          left: 1040,
          top: interpolate(stampProgress, [0, 1], [100, 330]),
          zIndex: 6,
          rotate: `${interpolate(stampProgress, [0, 1], [-13, -5])}deg`,
          scale: 1 - impact * 0.08,
          opacity: interpolate(stampProgress, [0, 0.08], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}
      >
        <div
          style={{
            display: 'grid',
            width: 210,
            height: 122,
            placeItems: 'center',
            color: PALETTE.red,
            backgroundColor: PALETTE.redSoft,
            border: `5px solid ${PALETTE.red}`,
            borderRadius: 6,
          }}
        >
          <Stamp size={46} strokeWidth={2.3} />
          <div style={{...baseTextStyle, color: PALETTE.red, fontSize: 27, fontWeight: 900}}>司法确认</div>
        </div>
      </div>

      <FlowArrow left={1275} top={468} width={255} progress={resultProgress} accent="teal" />
      <div style={{position: 'absolute', left: 1545, top: 412, opacity: resultProgress, translate: `${(1 - resultProgress) * 36}px 0px`}}>
        <IconNode icon={ShieldCheck} label="可强制执行" detail="确认之后" accent="teal" compact />
      </div>
    </div>
  );
};

export const ArbitrationScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const scopeProgress = interpolate(frame, [16, 52], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });
  const agreementProgress = interpolate(frame, [82, 132], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const barrierProgress = interpolate(frame, [130, 154], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });
  const pathOpacity = interpolate(frame, [130, 158], [1, 0.18], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scopeHiddenRight = interpolate(scopeProgress, [0, 1], [100, 0]);

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="05" eyebrow="与仲裁" title="范围更窄，路径互斥" accent="red" />

      <div
        style={{
          position: 'absolute',
          left: 100,
          top: 272,
          width: 720,
          height: 590,
          boxSizing: 'border-box',
          backgroundColor: PALETTE.paper,
          border: `4px solid ${PALETTE.blue}`,
          borderRadius: 8,
          clipPath: `inset(0 ${scopeHiddenRight}% 0 0)`,
        }}
      >
        <div style={{...baseTextStyle, position: 'absolute', left: 28, top: 25, color: PALETTE.blue, fontSize: 23, fontWeight: 850}}>法院主管范围</div>
        <Landmark style={{position: 'absolute', right: 44, top: 26, color: PALETTE.blue}} size={64} />
        <div
          style={{
            position: 'absolute',
            left: 150,
            top: 168,
            width: 420,
            height: 300,
            boxSizing: 'border-box',
            backgroundColor: PALETTE.redSoft,
            border: `4px solid ${PALETTE.red}`,
            borderRadius: 8,
          }}
        >
          <Scale style={{position: 'absolute', left: 160, top: 54, color: PALETTE.red}} size={90} strokeWidth={1.9} />
          <div style={{...baseTextStyle, position: 'absolute', left: 0, right: 0, bottom: 58, color: PALETTE.red, fontSize: 33, fontWeight: 900, textAlign: 'center'}}>仲裁范围</div>
        </div>
        <div style={{...baseTextStyle, position: 'absolute', left: 245, bottom: 35, fontSize: 28, fontWeight: 900}}>
          法院范围 <Keyword accent="blue">更宽</Keyword>
        </div>
      </div>

      <div style={{position: 'absolute', left: 900, top: 320, width: 900, height: 500}}>
        <div style={{position: 'absolute', left: 20, top: 134}}>
          <IconNode icon={FileText} label="有效仲裁协议" detail="当事人选择仲裁" accent="red" compact />
        </div>
        <div style={{position: 'absolute', left: 690, top: 124, opacity: pathOpacity}}>
          <CourtNode label="司法审判" />
        </div>
        <div style={{opacity: pathOpacity}}>
          <FlowArrow left={302} top={170} width={370} progress={1} accent="blue" label="司法路径" />
        </div>

        <div
          style={{
            position: 'absolute',
            left: interpolate(agreementProgress, [0, 1], [250, 480]),
            top: 276,
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            padding: '12px 18px',
            color: PALETTE.paper,
            backgroundColor: PALETTE.red,
            borderRadius: 6,
            fontFamily: '"Microsoft YaHei", sans-serif',
            fontSize: 22,
            fontWeight: 850,
          }}
        >
          <Scale size={30} />
          仲裁协议
        </div>

        <div
          style={{
            position: 'absolute',
            left: 578,
            top: 100,
            width: 18,
            height: 280,
            backgroundColor: PALETTE.red,
            borderRadius: 4,
            scale: `1 ${barrierProgress}`,
            transformOrigin: 'center top',
          }}
        />
        <ImpactReveal delay={158} style={{position: 'absolute', left: 430, top: 394}}>
          <div style={{...baseTextStyle, color: PALETTE.red, fontSize: 34, fontWeight: 900, textAlign: 'center'}}>
            或裁或审
            <div style={{marginTop: 8, fontSize: 22}}>排斥司法管辖</div>
          </div>
        </ImpactReveal>
      </div>
    </div>
  );
};

export const LaborScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const firstLeg = interpolate(frame, [34, 92], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const secondLeg = interpolate(frame, [140, 200], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const tokenX = frame < 132 ? interpolate(firstLeg, [0, 1], [390, 865]) : interpolate(secondLeg, [0, 1], [865, 1395]);

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="06" eyebrow="与劳动仲裁" title="必须先过仲裁关卡" accent="teal" />

      <div style={{position: 'absolute', left: 118, top: 436}}>
        <IconNode icon={BriefcaseBusiness} label="劳动争议" detail="起点" accent="blue" />
      </div>
      <div style={{position: 'absolute', left: 760, top: 394}}>
        <IconNode icon={Scale} label="劳动仲裁" detail="前置关卡" accent="teal" />
      </div>
      <div style={{position: 'absolute', left: 1430, top: 436}}>
        <CourtNode label="人民法院" />
      </div>

      <FlowArrow left={445} top={478} width={300} progress={firstLeg} accent="teal" label="先" />
      <FlowArrow left={1092} top={478} width={322} progress={secondLeg} accent="blue" label="不服裁决，再起诉" />

      <div
        style={{
          position: 'absolute',
          left: tokenX,
          top: 574,
          zIndex: 5,
          display: 'grid',
          width: 68,
          height: 68,
          placeItems: 'center',
          color: PALETTE.paper,
          backgroundColor: frame < 132 ? PALETTE.teal : PALETTE.blue,
          borderRadius: 34,
          boxShadow: '0 10px 26px rgba(23, 32, 29, 0.16)',
        }}
      >
        <BriefcaseBusiness size={36} strokeWidth={2.4} />
      </div>

      <ImpactReveal delay={96} style={{position: 'absolute', left: 814, top: 690}}>
        <div
          style={{
            ...baseTextStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 22px',
            color: PALETTE.paper,
            backgroundColor: PALETTE.teal,
            borderRadius: 6,
            fontSize: 32,
            fontWeight: 900,
          }}
        >
          <Stamp size={38} />
          仲裁前置
        </div>
      </ImpactReveal>
    </div>
  );
};

const RecapNode = ({icon: Icon, label, accent}: {readonly icon: LucideIcon; readonly label: string; readonly accent: Accent}) => (
  <div
    style={{
      ...baseTextStyle,
      display: 'flex',
      width: 218,
      height: 78,
      alignItems: 'center',
      gap: 14,
      boxSizing: 'border-box',
      padding: '12px 16px',
      backgroundColor: accentSoftColor(accent),
      border: `2px solid ${accentColor(accent)}`,
      borderRadius: 7,
      fontSize: 24,
      fontWeight: 850,
    }}
  >
    <Icon size={34} color={accentColor(accent)} strokeWidth={2.3} />
    {label}
  </div>
);

const recapRows = [
  {icon: Handshake, label: '人民调解', bridge: '司法确认', outcome: '可强制执行', accent: 'gold' as const, endIcon: ShieldCheck},
  {icon: Scale, label: '仲裁', bridge: '有效协议', outcome: '排斥司法管辖', accent: 'red' as const, endIcon: BadgeX},
  {icon: BriefcaseBusiness, label: '劳动仲裁', bridge: '仲裁前置', outcome: '不服再起诉', accent: 'teal' as const, endIcon: Landmark},
];

export const RecapScene = () => {
  const frame = toSourceFrame(useCurrentFrame());

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="07" eyebrow="最终关系图" title="一眼记住" accent="blue" />

      <MaskedReveal delay={18} duration={28} style={{position: 'absolute', left: 570, top: 88}}>
        <div style={{...baseTextStyle, fontSize: 31, fontWeight: 800}}>
          主管 = 法院的 <Keyword accent="red">受理权限范围</Keyword>
        </div>
      </MaskedReveal>

      {recapRows.map((row, index) => {
        const delay = index === 2 ? -58 : 34 + index * 28;
        const lineProgress = interpolate(frame, [delay, delay + 58], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ENTER_EASING,
        });
        const OutcomeIcon = row.endIcon;

        return (
          <div key={row.label} style={{position: 'absolute', left: 142, top: 292 + index * 190, width: 1640, height: 130}}>
            <div style={{position: 'absolute', left: 0, top: 16, opacity: lineProgress, translate: `${(1 - lineProgress) * -36}px 0px`}}>
              <RecapNode icon={row.icon} label={row.label} accent={row.accent} />
            </div>
            <FlowArrow left={238} top={20} width={300} progress={lineProgress} accent={row.accent} />
            <div
              style={{
                ...baseTextStyle,
                position: 'absolute',
                left: 565,
                top: 24,
                width: 245,
                padding: '16px 18px',
                color: accentColor(row.accent),
                backgroundColor: PALETTE.paper,
                borderBottom: `4px solid ${accentColor(row.accent)}`,
                fontSize: 25,
                fontWeight: 900,
                textAlign: 'center',
                opacity: lineProgress,
              }}
            >
              {row.bridge}
            </div>
            <FlowArrow left={830} top={20} width={268} progress={lineProgress} accent={row.accent} />
            <div style={{position: 'absolute', left: 1120, top: 16, opacity: lineProgress, translate: `${(1 - lineProgress) * 36}px 0px`}}>
              <RecapNode icon={OutcomeIcon} label={row.outcome} accent={row.accent} />
            </div>
          </div>
        );
      })}

      <ImpactReveal delay={180} style={{position: 'absolute', right: 112, bottom: 90}}>
        <div style={{...baseTextStyle, display: 'flex', alignItems: 'center', gap: 14, color: PALETTE.muted, fontSize: 21, fontWeight: 800}}>
          <FileCheck2 size={28} color={PALETTE.blue} />
          范围 · 排斥 · 前置
        </div>
      </ImpactReveal>
    </div>
  );
};
