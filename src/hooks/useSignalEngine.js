import { useEffect, useState } from 'react';
import { buildSignalSetup } from '../lib/signalLogic';

export function useSignalEngine(indicators) {
  const [setup, setSetup] = useState(null);

  useEffect(() => {
    setSetup(buildSignalSetup(indicators));
  }, [indicators]);

  return setup;
}
