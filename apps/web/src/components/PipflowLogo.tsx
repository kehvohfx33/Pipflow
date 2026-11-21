import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface PipflowLogoProps {
  compact?: boolean;
  disableSecretTrigger?: boolean;
  onTwentyClicks?: () => void;
}

export const PipflowLogo: React.FC<PipflowLogoProps> = ({
  compact = false,
  disableSecretTrigger = false,
  onTwentyClicks
}) => {
  const clicksRef = useRef<number[]>([]);
  const navigate = useNavigate();

  const handleClick = () => {
    if (disableSecretTrigger) return;
    const now = Date.now();
    clicksRef.current = [...clicksRef.current.filter((ts) => now - ts < 15000), now];
    if (clicksRef.current.length >= 20) {
      clicksRef.current = [];
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
