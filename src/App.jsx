import { useEffect, useState } from 'react';
import ScannerDashboard from './components/ScannerDashboard';
import EthConvictionMonitor from './components/EthConvictionMonitor';
import PerformancePage from './pages/performance';
import PaperTradingPage from './pages/paper-trading';
import ProofPage from './pages/proof';

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (pathname === '/performance') return <PerformancePage />;
  if (pathname === '/paper-trading') return <PaperTradingPage />;
  if (pathname === '/eth-conviction') return <EthConvictionMonitor />;
  if (pathname === '/proof' || pathname === '/validation') return <ProofPage />;
  return <ScannerDashboard />;
}
