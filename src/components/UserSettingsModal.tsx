import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  User,
  Image as ImageIcon,
  Check,
  Sparkles,
  Sun,
  Moon,
  Shield,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  LogOut,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { AVATAR_PRESETS } from "../data/avatars";

export default function UserSettingsModal() {
  const { user, profile, settingsModalOpen, closeSettingsModal, updateUserProfile, signOut, openAuthModal } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [displayName, setDisplayName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string>("");
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string>("");
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settingsModalOpen && user) {
      setDisplayName(profile?.displayName || user.displayName || "");
      const currentPhoto = profile?.photoURL || user.photoURL || "";
      setSelectedAvatar(currentPhoto);
      setCustomAvatarUrl(currentPhoto);
      setSuccessNotice(null);
      setErrorNotice(null);
    }
  }, [settingsModalOpen, user, profile]);

  if (!settingsModalOpen || !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorNotice(null);
    setSuccessNotice(null);

    if (!displayName.trim()) {
      setErrorNotice("Display name cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      const finalAvatar = useCustomUrl ? customAvatarUrl.trim() : selectedAvatar;
      await updateUserProfile(displayName.trim(), finalAvatar || undefined);
      setSuccessNotice("Profile updated successfully!");
      setTimeout(() => {
        setSuccessNotice(null);
      }, 3000);
    } catch (err: any) {
      console.error("Save profile error:", err);
      setErrorNotice(err.message || "Failed to update profile settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPreset = (url: string) => {
    setSelectedAvatar(url);
    setUseCustomUrl(false);
  };

  const currentPreview = useCustomUrl ? customAvatarUrl : selectedAvatar;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="relative w-full max-w-xl bg-[#0e101f] text-neutral-100 border border-white/[0.12] rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ambient Glows */}
          <div className="absolute top-0 right-0 w-60 h-60 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#e1147a] via-[#ec4899] to-[#9333ea] flex items-center justify-center shadow-lg shadow-pink-500/25">
                <User className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-white tracking-tight">Account Settings</h2>
                <p className="text-xs text-neutral-400">Customize your name, profile avatar and preferences</p>
              </div>
            </div>
            <button
              onClick={closeSettingsModal}
              className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body content with scrolling */}
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto space-y-6 pt-4 pr-1 hide-scrollbar">
            {/* Success or Error Notice */}
            {successNotice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{successNotice}</span>
              </motion.div>
            )}

            {errorNotice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorNotice}</span>
              </motion.div>
            )}

            {/* Current Avatar & Live Preview */}
            <div className="p-4 rounded-2xl bg-[#141628] border border-white/5 flex items-center gap-4">
              <div className="relative">
                {currentPreview ? (
                  <img
                    src={currentPreview}
                    alt="Selected Avatar"
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-pink-500/60 shadow-lg shadow-pink-500/20"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-pink-500 via-rose-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                    {(displayName || user.email || "G")[0].toUpperCase()}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#141628] flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase font-bold tracking-wider text-pink-400">Current Profile</span>
                <h3 className="text-base font-bold text-white truncate">
                  {displayName || "Unnamed Member"}
                </h3>
                <p className="text-xs text-neutral-400 truncate">
                  {user.isAnonymous ? "Guest Member" : user.email}
                </p>
              </div>
            </div>

            {/* Change Display Name */}
            <div>
              <label className="block text-xs font-semibold text-neutral-200 mb-1.5">
                Display Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your display name or nickname"
                  className="w-full bg-[#141628] border border-white/10 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/30 transition-all"
                />
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">This name is visible when you chat and interact with Dreamgirls.</p>
            </div>

            {/* Choose Avatar Presets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-neutral-200">
                  Choose an Avatar
                </label>
                <span className="text-[11px] text-pink-400 font-medium">12 styles available</span>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
                {AVATAR_PRESETS.map((preset) => {
                  const isSelected = !useCustomUrl && selectedAvatar === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset.url)}
                      className={`relative group aspect-square rounded-2xl overflow-hidden border-2 transition-all p-0.5 ${
                        isSelected
                          ? "border-pink-500 ring-2 ring-pink-500/40 scale-105 shadow-md shadow-pink-500/30"
                          : "border-white/10 hover:border-white/30 hover:scale-102 opacity-80 hover:opacity-100"
                      }`}
                    >
                      <img
                        src={preset.url}
                        alt={preset.name}
                        className="w-full h-full object-cover rounded-xl"
                        referrerPolicy="no-referrer"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-pink-500/20 backdrop-blur-[1px] flex items-center justify-center">
                          <div className="w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center text-white shadow">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Avatar URL input */}
            <div className="p-3.5 rounded-2xl bg-[#141628]/60 border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                  <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Or use custom Image URL</span>
                </label>
                {useCustomUrl && (
                  <span className="text-[10px] text-pink-400 font-semibold uppercase tracking-wider">Active</span>
                )}
              </div>
              <input
                type="url"
                value={customAvatarUrl}
                onChange={(e) => {
                  setCustomAvatarUrl(e.target.value);
                  setUseCustomUrl(true);
                }}
                placeholder="https://example.com/my-photo.jpg"
                className="w-full bg-[#0c0e18] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-pink-500/50"
              />
            </div>

            {/* Theme Preference */}
            <div className="p-4 rounded-2xl bg-[#141628] border border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center text-pink-400">
                  {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">App Theme</h4>
                  <p className="text-[11px] text-neutral-400">
                    Switch between Light and Dark mode
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/10 hover:bg-white/15 text-white transition-all"
              >
                {theme === "dark" ? (
                  <>
                    <Moon className="w-3.5 h-3.5 text-pink-400" />
                    <span>Dark Mode</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light Mode</span>
                  </>
                )}
              </button>
            </div>

            {/* Account & Security Section */}
            {user.isAnonymous && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-transparent border border-pink-500/20 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-pink-300">Upgrade to Permanent Account</h4>
                  <p className="text-[11px] text-neutral-400">
                    Link email to save your chats and access them on any device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeSettingsModal();
                    openAuthModal("signup");
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-bold text-white bg-gradient-to-r from-pink-500 to-purple-600 shadow"
                >
                  Link Email
                </button>
              </div>
            )}
          </form>

          {/* Footer Actions */}
          <div className="pt-4 mt-2 border-t border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={async () => {
                closeSettingsModal();
                await signOut();
              }}
              className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-red-400 transition-colors font-medium px-2 py-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={closeSettingsModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-300 hover:text-white hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/25 hover:scale-[1.01] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
