import { useEffect, useState } from 'react';
import { calculateIndicators } from '../lib/indicators';

export function useIndicators(candles) {
  const [indicators, setIndicators] = useState(null);

  useEffect(() => {
    setIndicators(calculateIndicators(candles));
  }, [candles]);

  return indicators;
}
