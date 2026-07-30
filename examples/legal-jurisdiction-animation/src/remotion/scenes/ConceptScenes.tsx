import {
  BriefcaseBusiness,
  Coins,
  FileText,
  Handshake,
  HeartHandshake,
  Landmark,
  Scale,
  UsersRound,
} from 'lucide-react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import {PALETTE, toSourceFrame} from '../storyboard';
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

export const DefinitionScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const pathProgress = interpolate(frame, [40, 112], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.5, 0, 0.2, 1),
  });
  const tokenX = interpolate(frame, [48, 116], [360, 1180], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.25, 1),
  });
  const impact = interpolate(frame, [112, 126, 150], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="01" eyebrow="概念" title="主管是什么？" accent="red" />

      <MaskedReveal delay={20} duration={30} style={{position: 'absolute', left: 120, top: 286}}>
        <div style={{...baseTextStyle, fontSize: 76, fontWeight: 900, lineHeight: 1.18}}>
          法院能否
          <br />
          <Keyword accent="red">受理</Keyword> 这个案件？
        </div>
      </MaskedReveal>

      <FlowArrow left={495} top={522} width={900} progress={pathProgress} accent="red" label="案件进入法院" />

      <div
        style={{
          position: 'absolute',
          left: tokenX,
          top: 514,
          zIndex: 4,
          display: 'flex',
          width: 226,
          height: 82,
          alignItems: 'center',
          gap: 15,
          boxSizing: 'border-box',
          padding: '14px 18px',
          color: PALETTE.ink,
          backgroundColor: PALETTE.paper,
          border: `2px solid ${PALETTE.red}`,
          borderRadius: 8,
          boxShadow: `0 12px 32px rgba(200, 63, 53, ${0.08 + impact * 0.12})`,
          scale: `${1 - impact * 0.08} ${1 + impact * 0.08}`,
        }}
      >
        <FileText size={42} color={PALETTE.red} strokeWidth={2.2} />
        <div style={{...baseTextStyle, fontSize: 27, fontWeight: 850}}>民事案件</div>
      </div>

      <CourtNode
        style={{
          position: 'absolute',
          left: 1410,
          top: 470,
          scale: interpolate(frame, [18, 44, 112, 126], [0.92, 1, 1, 1.04], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ENTER_EASING,
          }),
        }}
      />

      <ImpactReveal delay={124} style={{position: 'absolute', left: 1258, top: 676}}>
        <div
          style={{
            ...baseTextStyle,
            padding: '14px 24px',
            color: PALETTE.paper,
            backgroundColor: PALETTE.red,
            borderRadius: 6,
            fontSize: 34,
            fontWeight: 900,
          }}
        >
          受理权限范围
        </div>
      </ImpactReveal>
    </div>
  );
};

export const ScopeScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const boundaryProgress = interpolate(frame, [8, 42], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });
  const propertyProgress = interpolate(frame, [54, 112], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const personProgress = interpolate(frame, [104, 162], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  });
  const boundaryHiddenRight = interpolate(boundaryProgress, [0, 1], [100, 0]);

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="02" eyebrow="范围" title="哪些争议归法院？" accent="teal" />

      <MaskedReveal delay={24} duration={26} style={{position: 'absolute', left: 116, top: 300}}>
        <IconNode icon={UsersRound} label="平等主体" detail="双方地位平等" accent="blue" />
      </MaskedReveal>

      <div style={{position: 'absolute', left: 462, top: 318, width: 760, height: 440}}>
        <FlowArrow left={0} top={54} width={735} progress={propertyProgress} accent="gold" />
        <FlowArrow left={0} top={298} width={735} progress={personProgress} accent="teal" />
        <div
          style={{
            position: 'absolute',
            left: interpolate(propertyProgress, [0, 1], [26, 520]),
            top: 12,
          }}
        >
          <IconNode icon={Coins} label="财产关系" accent="gold" compact />
        </div>
        <div
          style={{
            position: 'absolute',
            left: interpolate(personProgress, [0, 1], [26, 520]),
            top: 254,
          }}
        >
          <IconNode icon={HeartHandshake} label="人身关系" accent="teal" compact />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 1255,
          top: 252,
          width: 545,
          height: 600,
          boxSizing: 'border-box',
          backgroundColor: `rgba(255, 255, 255, ${0.5 + boundaryProgress * 0.45})`,
          border: `4px solid ${PALETTE.red}`,
          borderRadius: 8,
          clipPath: `inset(0 ${boundaryHiddenRight}% 0 0)`,
        }}
      >
        <div style={{...baseTextStyle, position: 'absolute', left: 30, top: 26, color: PALETTE.red, fontSize: 22, fontWeight: 850}}>
          人民法院主管范围
        </div>
        <Landmark style={{position: 'absolute', left: 174, top: 152, color: PALETTE.red}} size={190} strokeWidth={1.8} />
        <div style={{...baseTextStyle, position: 'absolute', left: 85, right: 85, bottom: 66, fontSize: 37, fontWeight: 900, textAlign: 'center'}}>
          财产 + 人身
          <div style={{marginTop: 12, color: PALETTE.teal, fontSize: 25}}>发生争议</div>
        </div>
      </div>

      <ImpactReveal delay={172} style={{position: 'absolute', left: 560, top: 792}}>
        <div style={{...baseTextStyle, fontSize: 34, fontWeight: 800}}>
          <Keyword accent="teal">平等主体</Keyword> 之间的民事争议
        </div>
      </ImpactReveal>
    </div>
  );
};

const relationRows = [
  {label: '人民调解', detail: '协议的效力', icon: Handshake, accent: 'gold' as const},
  {label: '仲裁', detail: '或裁或审', icon: Scale, accent: 'red' as const},
  {label: '劳动仲裁', detail: '仲裁前置', icon: BriefcaseBusiness, accent: 'teal' as const},
];

export const RelationsScene = () => {
  const frame = toSourceFrame(useCurrentFrame());
  const cameraScale = interpolate(frame, [0, 96, 119], [0.96, 1, 1.035], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTER_EASING,
  });

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <SceneHeading index="03" eyebrow="关系总图" title="三条路径，三套规则" accent="blue" />
      <div style={{position: 'absolute', inset: 0, scale: cameraScale, transformOrigin: 'center 58%'}}>
        {relationRows.map((row, index) => {
          const delay = 18 + index * 18;
          const progress = interpolate(frame, [delay, delay + 34], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ENTER_EASING,
          });

          return (
            <div key={row.label}>
              <div
                style={{
                  position: 'absolute',
                  left: 170,
                  top: 288 + index * 198,
                  translate: `${interpolate(progress, [0, 1], [-54, 0])}px 0px`,
                  opacity: progress,
                }}
              >
                <IconNode icon={row.icon} label={row.label} detail={row.detail} accent={row.accent} />
              </div>
              <FlowArrow
                left={520}
                top={325 + index * 198}
                width={775}
                progress={progress}
                accent={row.accent}
                label={index === 0 ? '效力变化' : index === 1 ? '路径排斥' : '先后顺序'}
              />
            </div>
          );
        })}
        <CourtNode style={{position: 'absolute', left: 1375, top: 470}} label="人民法院" />
      </div>
    </div>
  );
};
