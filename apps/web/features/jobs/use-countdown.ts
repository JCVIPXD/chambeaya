'use client';

import { useEffect, useState } from 'react';

/** Cuenta regresiva en segundos enteros desde `seconds` (se reinicia si cambia). Llega a 0 y se detiene. */
export function useCountdown(seconds: number): number {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(seconds)));
  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil(seconds)));
    if (seconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return remaining;
}
