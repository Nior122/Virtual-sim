import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Persona } from "../types";
import { DEFAULT_PERSONAS } from "../data/defaultPersonas";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Phone,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  Video,
  ChevronRight,
  CheckCircle2,
  Compass,
  X
} from "lucide-react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import { getPersonaOnlineStatus } from "../utils/personaStatus";
import NativeAd from "./NativeAd";

export default function LandingPage() {
  const navigate = useNavigate();
  
  const [featuredPersonas, setFeaturedPersonas] = useState<Persona[]>(() => DEFAULT_PERSONAS);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);

  useEffect(() => {
    fetch("/api/personas")
      .then((res) => {
        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
          throw new Error(`HTTP ${res.status} non-JSON response`);
        }
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setFeaturedPersonas(data);
        }
      })
      .catch((err) => {
        console.warn("Using default featured personas:", err);
        setFeaturedPersonas(DEFAULT_PERSONAS);
      });
  }, []);

  // Reshuffle profiles positions every 30 seconds
  useEffect(() => {
    const shuffleInterval = setInterval(() => {
      setFeaturedPersonas((prev) => {
        if (prev.length <= 1) return prev;
        const copy = [...prev];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      });
    }, 30000); // 30 seconds

    return () => clearInterval(shuffleInterval);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-[#07080e] text-neutral-100 selection:bg-pink-500/30 overflow-x-hidden">
      {/* NAVBAR */}
      <Navbar onHowItWorksClick={() => setShowHowItWorksModal(true)} />

      <main className="flex-1 w-full">
        {/* HERO SECTION */}
        <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          {/* Subtle Ambient Radial Glows */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-tr from-pink-600/15 via-purple-600/15 to-transparent blur-3xl pointer-events-none -z-10" />

          <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
            {/* Top Pill Badge */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-pink-400 text-xs font-semibold mb-6 shadow-sm backdrop-blur-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Next-Generation 1-on-1 Video & Messaging</span>
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.1] mb-6"
            >
              Meet Verified Dreamgirls on{" "}
              <span className="bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] bg-clip-text text-transparent">
                Live Video Calls
              </span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-base sm:text-lg text-neutral-400 leading-relaxed font-normal max-w-2xl mx-auto mb-8"
            >
              Connect face-to-face with stunning creators and companions worldwide. Enjoy direct 1-on-1 video calls, real-time messaging, and exclusive photo galleries.
            </motion.p>

            {/* Hero CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3.5"
            >
              {/* Primary CTA -> Explore Dreamgirls */}
              <button
                onClick={() => navigate("/dreamgirls")}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-lg shadow-pink-500/25 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
              >
                <span>Explore Dreamgirls</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Secondary CTA -> How It Works Modal */}
              <button
                onClick={() => setShowHowItWorksModal(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold text-neutral-200 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 active:scale-95 transition-all cursor-pointer"
              >
                <span>How It Works</span>
              </button>
            </motion.div>
          </div>

          {/* HERO FEATURED CARDS SHOWCASE */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto"
          >
            {featuredPersonas.slice(0, 4).map((p) => {
              const status = getPersonaOnlineStatus(p.slug);
              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/dreamgirl/${p.slug}`)}
                  className="group relative rounded-2xl overflow-hidden bg-[#0d0f1a] border border-white/[0.08] hover:border-pink-500/50 cursor-pointer shadow-xl transition-all duration-300 hover:-translate-y-1.5 flex flex-col"
                >
                  {/* Bigger Image Portrait */}
                  <div className="relative aspect-[3/4.2] sm:h-80 w-full overflow-hidden bg-neutral-900">
                    {p.profileImage ? (
                      <img
                        src={p.profileImage}
                        alt={p.name}
                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-neutral-600 font-bold tracking-tighter">
                        {p.name.charAt(0)}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f1a] via-transparent to-transparent" />

                    {/* Online Status Badge with 🟢 dot */}
                    {status.isOnline ? (
                      <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-emerald-400 text-[10px] font-semibold flex items-center gap-1 shadow-md">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                        Online 🟢
                      </span>
                    ) : (
                      <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-neutral-300 text-[10px] font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                        {status.lastSeenText}
                      </span>
                    )}
                  </div>

                  {/* Info & CTA */}
                  <div className="p-3.5 bg-[#0d0f1a] flex items-center justify-between">
                    <div className="min-w-0 pr-2">
                      <h3 className="text-sm font-bold text-white group-hover:text-pink-300 transition-colors flex items-center gap-1 truncate">
                        <span>{p.name}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-pink-400 fill-current shrink-0" />
                      </h3>
                      <p className="text-[11px] text-neutral-400 truncate">
                        {[p.city, p.country].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-pink-500/30 group-hover:scale-110 transition-transform shrink-0">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>

          {/* Quick Explore Link under cards */}
          <div className="mt-8 text-center">
            <button
              onClick={() => navigate("/dreamgirls")}
              className="inline-flex items-center gap-1.5 text-xs text-pink-400 hover:text-pink-300 font-semibold group transition-colors cursor-pointer"
            >
              <span>View all available Dreamgirls in catalog</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </section>

        {/* EXPERIENCE & FEATURES SECTION */}
        <section className="py-16 md:py-24 border-t border-white/[0.06] bg-[#090b14]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-pink-400 text-xs font-semibold mb-3">
                <Video className="w-3.5 h-3.5" />
                <span>Premium Live Experience</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Designed for Authentic Connection
              </h2>
              <p className="text-neutral-400 text-sm mt-2">
                Everything you need for seamless 1-on-1 interaction with your favorite Dreamgirls.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-6 shadow-xl relative overflow-hidden group hover:border-pink-500/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-5 group-hover:scale-110 transition-transform">
                  <Phone className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">1-on-1 Live Video Calls</h3>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Start face-to-face video calls with a single tap. Experience smooth high-definition video, natural expressions, and interactive conversations.
                </p>
                <button
                  onClick={() => navigate("/dreamgirls")}
                  className="text-xs font-semibold text-pink-400 hover:text-pink-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>Start a Call</span>
                  <span>→</span>
                </button>
              </div>

              {/* Feature 2 */}
              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-6 shadow-xl relative overflow-hidden group hover:border-pink-500/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-5 group-hover:scale-110 transition-transform">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Direct Real-Time Chat</h3>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Send messages, share photos, and receive thoughtful, instantaneous replies tailored to each Dreamgirl's unique personality and background.
                </p>
                <button
                  onClick={() => navigate("/dreamgirls")}
                  className="text-xs font-semibold text-pink-400 hover:text-pink-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>Start Chatting</span>
                  <span>→</span>
                </button>
              </div>

              {/* Feature 3 */}
              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-6 shadow-xl relative overflow-hidden group hover:border-pink-500/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-5 group-hover:scale-110 transition-transform">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Verified Profiles</h3>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Every profile is carefully verified. Enjoy authentic personal stories, high quality photo albums, and detailed background bios.
                </p>
                <button
                  onClick={() => navigate("/dreamgirls")}
                  className="text-xs font-semibold text-pink-400 hover:text-pink-300 flex items-center gap-1 cursor-pointer"
                >
                  <span>Explore Catalog</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS SECTION */}
        <section className="py-16 md:py-24 border-t border-white/[0.06] bg-[#07080e] relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-pink-400 text-xs font-semibold mb-3">
                <Compass className="w-3.5 h-3.5" />
                <span>Simple 3-Step Guide</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                How Dream Babe Works
              </h2>
              <p className="text-neutral-400 text-sm mt-2">
                Getting connected is fast, easy, and completely free to explore.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-7 relative">
                <div className="w-10 h-10 rounded-full bg-pink-500/20 text-pink-400 font-bold text-sm flex items-center justify-center mb-5">
                  01
                </div>
                <h3 className="text-base font-bold text-white mb-2">1. Browse Dreamgirls</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Discover personalities across various categories, languages, and cities. Find companions that match your interests.
                </p>
              </div>

              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-7 relative">
                <div className="w-10 h-10 rounded-full bg-pink-500/20 text-pink-400 font-bold text-sm flex items-center justify-center mb-5">
                  02
                </div>
                <h3 className="text-base font-bold text-white mb-2">2. View Details & Photos</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Check out their curated photo gallery, background bio, hobbies, languages, and online availability.
                </p>
              </div>

              <div className="bg-[#0d0f1a] border border-white/[0.08] rounded-2xl p-7 relative">
                <div className="w-10 h-10 rounded-full bg-pink-500/20 text-pink-400 font-bold text-sm flex items-center justify-center mb-5">
                  03
                </div>
                <h3 className="text-base font-bold text-white mb-2">3. Start Call or Message</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Click to start a 1-on-1 video call or send a direct text message. Connect instantly in real-time.
                </p>
              </div>
            </div>

            <div className="mt-12 text-center">
              <button
                onClick={() => navigate("/dreamgirls")}
                className="px-8 py-3.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-lg shadow-pink-500/25 active:scale-95 transition-all cursor-pointer"
              >
                Browse All Dreamgirls Now
              </button>
            </div>
          </div>
        </section>

        {/* BOTTOM CALLOUT BANNER */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="relative rounded-3xl bg-gradient-to-r from-pink-950/40 via-purple-950/40 to-[#0d0f1a] border border-pink-500/20 p-8 sm:p-12 overflow-hidden text-center shadow-2xl">
            <div className="relative z-10 max-w-2xl mx-auto space-y-6">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Ready to Meet Your Favorite Dreamgirl?
              </h2>
              <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                Join thousands connecting every day on Dream Babe. Explore the complete catalog of verified creators now.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3.5 pt-2">
                <button
                  onClick={() => navigate("/dreamgirls")}
                  className="px-8 py-3.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-lg shadow-pink-500/25 active:scale-95 transition-all cursor-pointer"
                >
                  Explore All Dreamgirls
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* HOW IT WORKS MODAL */}
      <AnimatePresence>
        {showHowItWorksModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setShowHowItWorksModal(false)}
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
                  onClick={() => setShowHowItWorksModal(false)}
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
                    setShowHowItWorksModal(false);
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

      {/* In-page advert: owner's network code, or the house banner. Sits in the
          normal flow at the bottom of the page, directly above the footer. */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <NativeAd />
      </div>

      <Footer />
    </div>
  );
}
