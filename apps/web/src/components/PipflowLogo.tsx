import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface PipflowLogoProps {
  compact?: boolean;
  disableSecretTrigger?: boolean;
  onTwentyClicks?: () => void;
}

const REQUIRED_TAPS = 20;
const INACTIVITY_RESET_MS = 2500;
const SYNTHETIC_DEBOUNCE_MS = 60;

export const PipflowLogo: React.FC<PipflowLogoProps> = ({
  compact = false,
  disableSecretTrigger = false,
  onTwentyClicks
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tapCountRef = useRef(0);
  const lastTapAtRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const resetTaps = () => {
    tapCountRef.current = 0;
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (disableSecretTrigger) return;
    const handleOutsideInteraction = (ev: PointerEvent | MouseEvent) => {
      const target = ev.target as Node | null;
      if (buttonRef.current && target && !buttonRef.current.contains(target)) {
        resetTaps();
      }
    };
    document.addEventListener('pointerdown', handleOutsideInteraction, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideInteraction, true);
      resetTaps();
    };
  }, [disableSecretTrigger]);

  const handleClick = () => {
    if (disableSecretTrigger) return;
    const now = Date.now();
    if (now - lastTapAtRef.current < SYNTHETIC_DEBOUNCE_MS) {
      return;
    }
    if (lastTapAtRef.current > 0 && now - lastTapAtRef.current > INACTIVITY_RESET_MS) {
      tapCountRef.current = 0;
    }
    lastTapAtRef.current = now;
    tapCountRef.current += 1;

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, INACTIVITY_RESET_MS);

    if (tapCountRef.current >= REQUIRED_TAPS) {
      resetTaps();
      try {
        sessionStorage.setItem('pf_secret_console', '1');
      } catch {
        // ignore storage restrictions
      }
      if (onTwentyClicks) onTwentyClicks();
      else navigate('/_console');
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 select-none focus:outline-none cursor-pointer shrink-0 active:scale-95 transition-transform"
      title="Pipflowtrades"
      aria-label="Pipflowtrades Logo"
    >
      <img
        src="/assets/aistudio/IMG-20261115-WA0009_aca2a037.jpg"
        alt="Pipflowtrades Logo"
        className="h-9 w-9 rounded-full object-cover border border-emerald-500/60 shadow-sm shrink-0 bg-black"
        draggable={false}
      />
      {!compact && (
        <span className="font-extrabold tracking-tight text-sm sm:text-base whitespace-nowrap">
          <span className="text-sky-500">Pipfl</span>
          <span className="text-rose-500">ow</span>
          <span className="text-cyan-400">trades</span>
        </span>
      )}
    </button>
  );
};
