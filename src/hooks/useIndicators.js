import { useEffect, useState } from 'react';
import { calculateIndicators } from '../lib/indicators';

export function useIndicators(candles, timeframe = '15m') {
  const [indicators, setIndicators] = useState(null);

  useEffect(() => {
    setIndicators(calculateIndicators(candles, timeframe));
  }, [candles, timeframe]);

  return indicators;
}
