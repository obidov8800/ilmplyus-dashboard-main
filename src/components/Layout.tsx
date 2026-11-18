import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Aside from './Aside';
import AccessNotice from './AccessNotice';

const Layout = () => {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Sahifa (marshrut) o'zgarganda mobil menyuni avtomatik yopish
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Ekran kengayganda (desktop rejimiga o'tganda) mobil holatni tozalash
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`layout ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      {/* Mobil menyu foni (backdrop) */}
      <div
        className={`aside-backdrop ${mobileOpen ? 'show' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <Aside
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onOpen={() => setCollapsed(false)}
        onClose={() => setCollapsed(true)}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="layout-main">
        <Header
          mobileOpen={mobileOpen}
          onToggleMobile={() => setMobileOpen((v) => !v)}
        />

        <main className="page">
          {/* Shartnomasiz foydalanuvchi uchun tushuntirish (kirgandan keyin; yopish mumkin). */}
          <AccessNotice />
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
