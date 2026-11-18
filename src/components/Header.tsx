import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import userIcon from '../assets/images/user-icon.svg';
import LanguageSelect from './LanguageSelect/LanguageSelect';
import useAuthStore from '../store/useAuthStore';
import { useAccount } from '../services/account';

interface HeaderProps {
  mobileOpen?: boolean;
  onToggleMobile?: () => void;
}

const Header = ({ mobileOpen, onToggleMobile }: HeaderProps) => {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Ism va rol — yagona hisob servisidan (`services/account.ts`), qo'shimcha `/me` so'rovisiz. Juda uzun ism sarlavhaga
  // sig'masdan siljib ketmasin: familiya to'liq, qolgan so'zlar bosh harfi bilan; to'liq ism — sichqoncha ustida.
  const { account } = useAccount();
  const fullName = account?.fullName ?? '';
  const displayName = account?.shortName ?? '';
  const roleName = account?.roleName ?? '';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggleMobile}
          aria-label={mobileOpen ? "Menyuni yopish" : "Menyuni ochish"}
          title={mobileOpen ? "Menyuni yopish" : "Menyuni ochish"}
        >
          <i className={`fa-solid ${mobileOpen ? 'fa-xmark' : 'fa-bars'}`} />
        </button>
      </div>

      <div className="header-right">
        <LanguageSelect />
        <div className="header-user-wrapper" ref={ref}>
          <div className="header-user-trigger" onClick={() => setOpen((v) => !v)}>
            <div className="user-info-text">
              <h1 className="user-name" title={fullName}>
                {displayName}
              </h1>
              <p className="user-role">{roleName}</p>
            </div>

            <div className="user-icon-circle">
              <img src={userIcon} alt="" />
            </div>
          </div>

          {open && (
            <div className="header-dropdown">
              <button className="header-dropdown-item" onClick={handleLogout}>
                <i className="fa-solid fa-arrow-right-from-bracket header-dropdown-icon" />
                Chiqish
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
