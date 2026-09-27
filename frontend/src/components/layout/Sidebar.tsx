import { ChevronDown, Clock, LayoutDashboard, LogOut, PenSquare, Send, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useEmailStats } from "../../hooks/queries";
import { buttonClasses } from "../ui/Button";
import { Avatar } from "../ui/Avatar";

function NavItem({ to, label, count, icon }: { to: string; label: string; count?: number | undefined; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"
        }`
      }
    >
      <span className="flex items-center gap-2.5">
        {icon}
        {label}
      </span>
      {count !== undefined ? <span className="text-xs font-semibold tabular-nums">{count.toLocaleString()}</span> : null}
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    toast.info("Signed out");
    navigate("/login", { replace: true });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-3 rounded-xl border border-line bg-canvas p-3 text-left hover:bg-white"
      >
        <Avatar name={user.name} src={user.avatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-line bg-white p-1 shadow-lg">
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas">
            <Settings aria-hidden="true" className="h-4 w-4" /> Settings
          </Link>
          {user.isAdmin ? (
            <a role="menuitem" href="/admin/queues" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-canvas">
              <LayoutDashboard aria-hidden="true" className="h-4 w-4" /> Queue dashboard
            </a>
          ) : null}
          <button role="menuitem" type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <LogOut aria-hidden="true" className="h-4 w-4" /> Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const stats = useEmailStats();

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-line bg-white px-4 py-6">
      <Link to="/scheduled" className="px-2 text-2xl font-black tracking-tight text-ink">
        ONB
      </Link>
      <UserMenu />
      <Link to="/compose" className={buttonClasses("outline", "lg", "w-full rounded-full")}>
        <PenSquare aria-hidden="true" className="h-4 w-4" />
        Compose
      </Link>
      <nav aria-label="Mailboxes" className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted uppercase">Core</p>
        <NavItem to="/scheduled" label="Scheduled" count={stats.data?.scheduled} icon={<Clock aria-hidden="true" className="h-4 w-4" />} />
        <NavItem to="/sent" label="Sent" count={stats.data?.sent} icon={<Send aria-hidden="true" className="h-4 w-4" />} />
      </nav>
      <nav aria-label="Account" className="mt-auto flex flex-col gap-1">
        <NavItem to="/settings" label="Settings" icon={<Settings aria-hidden="true" className="h-4 w-4" />} />
      </nav>
    </aside>
  );
}
