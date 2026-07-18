'use client';

import { motion, useAnimation, useInView } from 'motion/react';
import { useEffect, useRef } from 'react';

interface BoxRevealProps {
  children: React.ReactNode;
  width?: 'fit-content' | '100%';
  boxColor?: string;
  duration?: number;
  delay?: number;
}

export const BoxReveal = ({
  children,
  width = 'fit-content',
  boxColor = 'hsl(var(--primary))',
  duration = 0.5,
  delay = 0.2,
}: BoxRevealProps) => {
  const mainControls = useAnimation();
  const slideControls = useAnimation();

  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-10%' });

  useEffect(() => {
    if (isInView) {
      slideControls.start('visible');
      mainControls.start('visible');
    }
  }, [isInView, mainControls, slideControls]);

  return (
    <div ref={ref} className="relative overflow-hidden" style={{ width }}>
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 15, scale: 0.98, filter: 'blur(8px)' },
          visible: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
        }}
        initial="hidden"
        animate={mainControls}
        transition={{
          duration: duration * 1.5,
          delay: delay + 0.1,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        {children}
      </motion.div>

      <motion.div
        variants={{
          hidden: { left: '-100%' },
          visible: { left: '100%' },
        }}
        initial="hidden"
        animate={slideControls}
        transition={{
          duration: duration,
          ease: [0.85, 0, 0.15, 1],
          delay: delay,
        }}
        className="absolute inset-y-0 z-30 pointer-events-none"
        style={{
          width: '100%',
          background: `linear-gradient(90deg, transparent 0%, ${boxColor} 50%, transparent 100%)`,
          boxShadow: `0 0 40px ${boxColor}33`,
          mixBlendMode: 'screen',
          opacity: 0.8,
        }}
      />

      {/* 辅助光效 */}
      <motion.div
        variants={{
          hidden: { left: '-100%' },
          visible: { left: '100%' },
        }}
        initial="hidden"
        animate={slideControls}
        transition={{
          duration: duration * 0.8,
          ease: [0.85, 0, 0.15, 1],
          delay: delay + 0.05,
        }}
        className="absolute inset-y-0 z-40 pointer-events-none"
        style={{
          width: '40%',
          background: `linear-gradient(90deg, transparent 0%, white 50%, transparent 100%)`,
          opacity: 0.2,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  );
};
