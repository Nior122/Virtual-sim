import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Sparkles,
  Menu,
  X,
  User as UserIcon,
  LogOut,
  ShieldCheck,
  ChevronDown,
  Sun,
  Moon,
  Settings,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";

interface NavbarProps {
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  activeNav?: string;
  onHowItWorksClick?: () => void;
}

export default function Navbar({
  searchQuery = "",
  onSearchChange,
  activeNav,
  onHowItWorksClick,
}: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, openAuthModal, openSettingsModal, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleHowItWorks = () => {
    if (onHowItWorksClick) {
      onHowItWorksClick();
    } else {
      setHowItWorksOpen(true);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearchChange) {
      onSearchChange(localSearch);
    } else {
      navigate(`/dreamgirls?q=${encodeURIComponent(localSearch)}`);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-[#07080e]/90 backdrop-blur-xl border-b border-white/[0.08] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 sm:h-20 flex items-center justify-between gap-4">
          {/* LOGO */}
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#e1147a] via-[#ec4899] to-[#9333ea] flex items-center justify-center shadow-lg shadow-pink-500/25 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center">
              <span className="font-extrabold text-xl sm:text-2xl tracking-tight text-white group-hover:text-pink-400 transition-colors">
                Dream Babe
              </span>
            </div>
          </Link>

          {/* DESKTOP NAV LINKS */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            <Link
              to="/"
              className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                location.pathname === "/"
                  ? "text-white bg-white/[0.08] font-semibold"
                  : "text-neutral-300 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              Discover
            </Link>
            <Link
              to="/dreamgirls"
              className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                location.pathname === "/dreamgirls" || location.pathname === "/personas"
                  ? "text-white bg-white/[0.08] font-semibold"
                  : "text-neutral-300 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              Explore Dreamgirls
            </Link>
            <button
              onClick={handleHowItWorks}
              className="px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              How It Works
            </button>
          </nav>

          {/* SEARCH BAR (Center/Right) */}
          <form onSubmit={handleSearchSubmit} className="hidden sm:flex items-center flex-1 max-w-xs lg:max-w-sm mx-2">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={onSearchChange ? searchQuery : localSearch}
                onChange={(e) => {
                  setLocalSearch(e.target.value);
                  if (onSearchChange) onSearchChange(e.target.value);
                }}
                placeholder="Search Dreamgirls..."
                className="w-full bg-[#121422]/90 border border-white/10 rounded-full pl-9 pr-8 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/30 transition-all"
              />
              {(onSearchChange ? searchQuery : localSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearch("");
                    if (onSearchChange) onSearchChange("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </form>

          {/* RIGHT ACTIONS (Explore + Theme Toggle + User Auth) */}
          <div className="hidden sm:flex items-center gap-2.5 shrink-0">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
              className="p-2 rounded-full bg-[#141628] hover:bg-[#1f233d] border border-white/10 text-neutral-300 hover:text-pink-400 transition-all"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-pink-400" />}
            </button>

            <button
              onClick={() => navigate("/dreamgirls")}
              className="px-4 py-2 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/20 hover:scale-[1.02] active:scale-95 transition-all"
            >
              Explore Dreamgirls
            </button>

            {/* Auth Button or User Profile Dropdown */}
            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 py-1.5 px-3 rounded-full bg-[#141628] border border-white/10 hover:border-pink-500/40 text-xs text-white transition-all hover:bg-[#1a1e36]"
                >
                  {profile?.photoURL || user.photoURL ? (
                    <img
                      src={profile?.photoURL || user.photoURL!}
                      alt={profile?.displayName || user.displayName || "User"}
                      className="w-6 h-6 rounded-full object-cover border border-pink-500/50"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">
                      {(profile?.displayName || user.displayName || user.email || "G")[0].toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium max-w-[90px] truncate">
                    {profile?.displayName || user.displayName || (user.isAnonymous ? "Guest" : user.email?.split("@")[0])}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${userDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Menu */}
                <AnimatePresence>
                  {userDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      className="absolute right-0 mt-2 w-60 bg-[#0e101f] border border-white/10 rounded-2xl p-2 shadow-2xl z-50 space-y-1"
                    >
                      <div className="px-3 py-2 border-b border-white/5">
                        <p className="text-xs font-semibold text-white truncate">
                          {profile?.displayName || user.displayName || (user.isAnonymous ? "Guest Member" : "Dream Babe Member")}
                        </p>
                        <p className="text-[11px] text-neutral-400 truncate">
                          {user.isAnonymous ? "Anonymous Guest" : user.email}
                        </p>
                      </div>

                      {/* Settings & Avatar Selection */}
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          openSettingsModal();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-200 hover:text-white hover:bg-white/10 rounded-xl transition-colors text-left"
                      >
                        <Settings className="w-4 h-4 text-pink-400" />
                        <span>Profile & Avatar Settings</span>
                      </button>

                      {user.isAnonymous && (
                        <button
                          onClick={() => {
                            setUserDropdownOpen(false);
                            openAuthModal("signup");
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-pink-400 hover:bg-pink-500/10 rounded-xl transition-colors text-left"
                        >
                          <ShieldCheck className="w-4 h-4 text-pink-400" />
                          <span>Link Account / Save Chats</span>
                        </button>
                      )}

                      <button
                        onClick={async () => {
                          setUserDropdownOpen(false);
                          await signOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-300 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors text-left border-t border-white/5 pt-2 mt-1"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={() => openAuthModal("signin")}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-200 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-pink-500/30 transition-all"
              >
                <UserIcon className="w-3.5 h-3.5 text-pink-400" />
                <span>Sign In</span>
              </button>
            )}
          </div>

          {/* MOBILE MENU TOGGLE */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-full bg-white/5 text-neutral-300"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-pink-400" />}
            </button>

            {user ? (
              <button
                onClick={() => openSettingsModal()}
                className="w-7 h-7 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white overflow-hidden"
              >
                {profile?.photoURL || user.photoURL ? (
                  <img src={profile?.photoURL || user.photoURL!} alt="User" className="w-full h-full object-cover" />
                ) : (
                  (profile?.displayName || user.displayName || user.email || "G")[0].toUpperCase()
                )}
              </button>
            ) : (
              <button
                onClick={() => openAuthModal("signin")}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-white"
              >
                Sign In
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-neutral-300 hover:text-white rounded-lg hover:bg-white/5"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* MOBILE MENU ACCORDION */}
        {mobileMenuOpen && (
          <div className="sm:hidden px-4 pt-2 pb-6 bg-[#0c0e18] border-b border-white/10 space-y-3">
            <form onSubmit={handleSearchSubmit} className="relative w-full my-2">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={onSearchChange ? searchQuery : localSearch}
                onChange={(e) => {
                  setLocalSearch(e.target.value);
                  if (onSearchChange) onSearchChange(e.target.value);
                }}
                placeholder="Search Dreamgirls..."
                className="w-full bg-[#121422] border border-white/10 rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-pink-500/50"
              />
            </form>

            <div className="flex flex-col space-y-2 pt-2 border-t border-white/5">
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-white/5 rounded-lg"
              >
                Discover
              </Link>
              <Link
                to="/dreamgirls"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 text-xs font-medium text-neutral-200 hover:bg-white/5 rounded-lg"
              >
                Explore Dreamgirls
              </Link>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleHowItWorks();
                }}
                className="px-3 py-2 text-xs font-medium text-left text-neutral-200 hover:bg-white/5 rounded-lg"
              >
                How It Works
              </button>

              {user ? (
                <>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      openSettingsModal();
                    }}
                    className="px-3 py-2 text-xs font-medium text-left text-pink-300 hover:bg-pink-500/10 rounded-lg flex items-center gap-2"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Profile & Avatar Settings</span>
                  </button>

                  <button
                    onClick={async () => {
                      setMobileMenuOpen(false);
                      await signOut();
                    }}
                    className="px-3 py-2 text-xs font-medium text-left text-red-400 hover:bg-red-500/10 rounded-lg flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out ({profile?.displayName || user.displayName || user.email || "Guest"})</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openAuthModal("signin");
                  }}
                  className="px-3 py-2 text-xs font-medium text-left text-pink-400 hover:bg-pink-500/10 rounded-lg flex items-center gap-2"
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>Sign In / Create Account</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* HOW IT WORKS MODAL */}
      <AnimatePresence>
        {howItWorksOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setHowItWorksOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0e101f] border border-white/[0.1] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">How Dream Babe Works</h3>
                    <p className="text-xs text-neutral-400">Direct connections with verified Dreamgirls</p>
                  </div>
                </div>
                <button
                  onClick={() => setHowItWorksOpen(false)}
                  className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs text-neutral-300">
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </span>
                  <div>
                    <h4 className="font-semibold text-white">Discover & Choose Who to Meet</h4>
                    <p className="text-neutral-400 mt-0.5">
                      Explore Dreamgirl profiles from around the world, browse their stories, photos, and background.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </span>
                  <div>
                    <h4 className="font-semibold text-white">Connect on Live Video</h4>
                    <p className="text-neutral-400 mt-0.5">
                      Start a 1-on-1 video call instantly. Experience real face-to-face interaction and lively reactions.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </span>
                  <div>
                    <h4 className="font-semibold text-white">Direct Chat & Share Media</h4>
                    <p className="text-neutral-400 mt-0.5">
                      Stay in touch anytime with direct messaging, share photos, and build genuine connections.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setHowItWorksOpen(false);
                    navigate("/dreamgirls");
                  }}
                  className="w-full py-3 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] to-[#9333ea] shadow-md shadow-pink-500/20"
                >
                  Start Exploring Dreamgirls
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
