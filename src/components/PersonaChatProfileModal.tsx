import { useState, useEffect } from "react";
import { Persona } from "../types";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  MapPin,
  Briefcase,
  Flame,
  Sparkles,
  ExternalLink,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Heart,
  User,
  ThumbsDown
} from "lucide-react";

interface PersonaChatProfileModalProps {
  persona: Persona | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PersonaChatProfileModal({
  persona,
  isOpen,
  onClose,
}: PersonaChatProfileModalProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedImageIndex !== null) {
          setSelectedImageIndex(null);
        } else {
          onClose();
        }
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedImageIndex, onClose]);

  if (!isOpen || !persona) return null;

  const galleryImages = persona.gallery
    ? persona.gallery.split(",").map((url) => url.trim()).filter(Boolean)
    : [];
  const allImages = [persona.profileImage, persona.coverImage, ...galleryImages].filter(Boolean) as string[];

  const locationStr = [persona.city, persona.country].filter(Boolean).join(", ");

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-full max-w-md bg-[#0d0d12] border border-white/15 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] z-10 text-white"
        >
          {/* Top Bar with Close Button */}
          <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white/80 hover:text-white flex items-center justify-center border border-white/15 backdrop-blur-sm transition-colors"
              title="Close Profile"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
            {/* Cover Banner */}
            <div className="relative h-36 sm:h-44 w-full bg-neutral-900 overflow-hidden">
              {persona.coverImage ? (
                <img
                  src={persona.coverImage}
                  alt="Cover"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-full h-full object-cover select-none"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-purple-950/60 via-neutral-900 to-pink-950/40" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d12] via-transparent to-black/30" />
            </div>

            {/* Profile Header Details */}
            <div className="px-5 pt-0 pb-4 relative">
              {/* Avatar */}
              <div className="relative -mt-14 mb-3 inline-block">
                <div className="w-22 h-22 sm:w-24 sm:h-24 rounded-full border-4 border-[#0d0d12] overflow-hidden bg-neutral-800 shadow-xl">
                  {persona.profileImage ? (
                    <img
                      src={persona.profileImage}
                      alt={persona.name}
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-full h-full object-cover select-none"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold bg-neutral-800">
                      {persona.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0d0d12]" title="Online" />
              </div>

              {/* Name & Headline */}
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {persona.name}
                </h2>
                {persona.age && (
                  <span className="text-base text-neutral-400 font-medium">
                    {persona.age}
                  </span>
                )}
              </div>

              {/* Bio / Description */}
              <p className="text-neutral-300 text-sm leading-relaxed mb-4">
                {persona.shortBio || persona.description || persona.longBio || "No bio provided."}
              </p>

              {/* Quick Meta Badges */}
              <div className="flex flex-wrap gap-2 mb-4 text-xs">
                {locationStr && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-neutral-300">
                    <MapPin className="w-3 h-3 text-purple-400" />
                    <span>{locationStr}</span>
                  </div>
                )}

                {persona.occupation && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-neutral-300">
                    <Briefcase className="w-3 h-3 text-purple-400" />
                    <span>{persona.occupation}</span>
                  </div>
                )}

                <div className="flex items-center gap-1 px-2.5 py-1 bg-purple-950/40 border border-purple-500/30 rounded-full text-purple-300 font-medium">
                  <Flame className="w-3 h-3 text-pink-400" />
                  <span>Flirt: {persona.flirtLevel || 3}/4</span>
                </div>
              </div>

              {/* Personality */}
              {persona.personality && (
                <div className="mb-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-purple-400" /> Personality
                  </h4>
                  <p className="text-sm text-neutral-300 leading-relaxed">{persona.personality}</p>
                </div>
              )}

              {/* Interests */}
              {persona.interests && (
                <div className="mb-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1">
                    Interests & Passions
                  </h4>
                  <p className="text-sm text-neutral-300 leading-relaxed">{persona.interests}</p>
                </div>
              )}

              {/* Likes & Dislikes */}
              {(persona.likes || persona.dislikes) && (
                <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                  {persona.likes && (
                    <div className="p-2.5 bg-emerald-950/20 border border-emerald-500/20 rounded-xl">
                      <span className="font-semibold text-emerald-400 flex items-center gap-1 mb-1">
                        <Heart className="w-3 h-3" /> Likes
                      </span>
                      <p className="text-neutral-300 leading-snug">{persona.likes}</p>
                    </div>
                  )}
                  {persona.dislikes && (
                    <div className="p-2.5 bg-red-950/20 border border-red-500/20 rounded-xl">
                      <span className="font-semibold text-red-400 flex items-center gap-1 mb-1">
                        <ThumbsDown className="w-3 h-3" /> Dislikes
                      </span>
                      <p className="text-neutral-300 leading-snug">{persona.dislikes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Photo Gallery Grid */}
              {allImages.length > 0 && (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      Photos (5 Photos)
                    </h4>
                    <span className="text-[10px] text-pink-400 font-medium">Verified Gallery</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {allImages.slice(0, 5).map((imgUrl, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedImageIndex(i)}
                        className={`relative rounded-xl overflow-hidden bg-neutral-800 border border-white/10 hover:border-pink-400/50 transition-all hover:scale-[1.02] active:scale-95 group ${
                          i === 0 ? "col-span-2 aspect-[16/10]" : "aspect-square"
                        }`}
                      >
                        <img
                          src={imgUrl}
                          alt={`${persona.name} ${i}`}
                          referrerPolicy="no-referrer"
                          draggable={false}
                          onContextMenu={(e) => e.preventDefault()}
                          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity select-none"
                        />
                      </button>
                    ))}
                  </div>
                  {/* View All Button */}
                  <a
                    href="https://fansleak.pages.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full mt-2.5 py-2 px-3 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/20 flex items-center justify-center gap-1.5 transition-all text-center cursor-pointer"
                  >
                    <span>View All</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Actions Bar */}
          <div className="p-4 border-t border-white/10 bg-black/40 backdrop-blur-md flex items-center gap-2.5 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <MessageSquare className="w-4 h-4 text-purple-300" />
              Back to Chat
            </button>

            <a
              href={`/persona/${persona.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/30"
              title="Open full page profile"
            >
              <ExternalLink className="w-4 h-4" />
              Full Page
            </a>
          </div>
        </motion.div>

        {/* Photo Lightbox Popup if an image is clicked */}
        <AnimatePresence>
          {selectedImageIndex !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-60 bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
              onClick={() => setSelectedImageIndex(null)}
            >
              <button
                onClick={() => setSelectedImageIndex(null)}
                className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-70"
              >
                <X className="w-6 h-6" />
              </button>

              <div
                className="relative max-w-2xl max-h-[85vh] flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={allImages[selectedImageIndex]}
                  alt="Enlarged"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/15"
                />

                {allImages.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImageIndex(
                          (selectedImageIndex - 1 + allImages.length) % allImages.length
                        );
                      }}
                      className="absolute left-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 border border-white/10 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImageIndex((selectedImageIndex + 1) % allImages.length);
                      }}
                      className="absolute right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 border border-white/10 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AnimatePresence>
  );
}
