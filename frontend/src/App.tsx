import './index.css';
import KioskPage from './pages/KioskPage';
import SelectPage from './pages/SelectPage';
import type { PageType } from './utils/token';

const pageType = (import.meta.env.VITE_PAGE_TYPE ?? 'signin') as PageType;

export default function App() {
  const params  = new URLSearchParams(window.location.search);
  const action  = params.get('action') as PageType | null;
  const w       = params.get('w');

  // Student scanned the QR — show name selection
  if (action && w) {
    return <SelectPage action={action} w={w} />;
  }

  // Default: kiosk display
  return <KioskPage type={pageType} />;
}
