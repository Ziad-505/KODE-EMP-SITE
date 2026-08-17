import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import kMark from '../assets/kode-k-mark.png';
import { useAuth } from '../lib/auth-context';
import { useReveal } from '../lib/reveal';
import { Icon } from './icon';
import { SearchPalette } from './search-palette';

/**
 * Primary navigation.
 *
 * The original draft hid this outright below 850px, which left every inner page
 * unreachable on a phone. The same list now drives a full-screen drawer at that
 * breakpoint, so the information architecture is identical on both.
 */
const NAVIGATION = [
  { label: 'Home', to: '/' },
  { label: 'News', to: '/news' },
  { label: 'Events', to: '/events' },
  { label: 'Policies', to: '/policies' },
  { label: 'People', to: '/directory' },
] as const;

const MORE_NAVIGATION = [
  { label: 'FAQs', to: '/faqs' },
  { label: 'Gallery', to: '/gallery' },
  { label: 'Useful links', to: '/links' },
  { label: 'IT support', to: '/support' },
] as const;

export function PortalLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useReveal();

  useEffect(() => {
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // The drawer covers the page; stop the body scrolling behind it.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="kode-world">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        onOpenSearch={() => setSearchOpen(true)}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
        drawerOpen={drawerOpen}
      />
      {drawerOpen ? <MobileDrawer onClose={() => setDrawerOpen(false)} /> : null}
      {/* Keyed on the path so React remounts the subtree on navigation and the
          page-enter animation replays. Without the key the DOM is reused and
          the animation only ever runs once, on first load. */}
      <div id="main" className="page-swap" key={location.pathname}>
        <Outlet />
      </div>
      <Footer />
      {searchOpen ? <SearchPalette onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
}

function Header({
  onOpenSearch,
  onToggleDrawer,
  drawerOpen,
}: {
  onOpenSearch: () => void;
  onToggleDrawer: () => void;
  drawerOpen: boolean;
}) {
  return (
    <header className="floating-header">
      <Link className="brand-button" to="/" aria-label="KODE Sports Club home">
        <img src={kMark} alt="" />
        <span>
          KODE
          <br />
          <b>SPORTS CLUB / PORTAL</b>
        </span>
      </Link>

      <nav aria-label="Primary">
        {NAVIGATION.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {item.label}
          </NavLink>
        ))}
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}>
          More
        </NavLink>
      </nav>

      <div className="header-actions">
        <button className="global-search" onClick={onOpenSearch} type="button">
          <Icon name="search" />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <AccountMenu />
        <button
          className="menu-button"
          type="button"
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} />
        </button>
      </div>
    </header>
  );
}

function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div ref={container} style={{ position: 'relative' }}>
      <button
        className="account-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span>{user.firstName.toUpperCase()}</span>
      </button>

      {open ? (
        <div className="account-menu" role="menu">
          <p>
            {user.displayName}
            <small>{user.departmentName ?? 'KODE Sports Club'}</small>
          </p>
          <Link to="/profile" role="menuitem">
            <Icon name="user" size={15} /> My profile
          </Link>
          <Link to="/support" role="menuitem">
            <Icon name="ticket" size={15} /> My IT requests
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await signOut();
              navigate('/sign-in');
            }}
          >
            <Icon name="logout" size={15} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="mobile-drawer" id="mobile-navigation">
      <nav aria-label="Primary mobile">
        {[...NAVIGATION, ...MORE_NAVIGATION].map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onClose}>
            {item.label}
            <Icon name="arrow" />
          </NavLink>
        ))}
      </nav>
      <footer>THE CLUB, FROM THE INSIDE. CAIRO / 2026</footer>
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <Link className="footer-brand" to="/">
        <img src={kMark} alt="KODE Sports Club" />
      </Link>
      <div>
        <p>THE CLUB, FROM THE INSIDE.</p>
        <span>CAIRO / 2026</span>
      </div>
      <nav aria-label="Footer">
        <Link to="/directory">CONTACTS</Link>
        <Link to="/gallery">GALLERY</Link>
        <Link to="/links">USEFUL LINKS</Link>
      </nav>
    </footer>
  );
}
