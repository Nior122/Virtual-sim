import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { Persona } from "../types";
import { DEFAULT_PERSONAS } from "../data/defaultPersonas";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Phone,
  MessageSquare,
  Heart,
  User,
  Sun,
  Image as ImageIcon,
  Video,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  CheckCircle2,
  Music,
  Shirt,
  Plane,
  Film,
  Utensils,
  Camera,
  Laptop,
  Wine,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Flame,
  Eye,
  Ruler,
  Feather,
  Lock
} from "lucide-react";
import Footer from "./Footer";
import { usePrivateMode } from "../hooks/useSiteMode";
import {
  getPersonaOnlineStatus,
  togglePersonaOnlineStatus,
  subscribeToPersonaStatus,
  PersonaOnlineStatus
} from "../utils/personaStatus";

export default function PersonaDetail() {
  
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as any;
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "about" | "physical" | "intimacy" | "personality" | "interests" | "photos" | "conversation"
  >(
    tabParam && ["about", "physical", "intimacy", "personality", "interests", "photos", "conversation"].includes(tabParam)
      ? tabParam
      : "about"
  );

  useEffect(() => {
    if (tabParam && ["about", "physical", "intimacy", "personality", "interests", "photos", "conversation"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);
  // Private mode: this page is the only one a visitor may see, so the footer
  // (and its home / browse links) is not rendered at all.
  const isPrivate = usePrivateMode();
  const [readMore, setReadMore] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [status, setStatus] = useState<PersonaOnlineStatus>(() =>
    getPersonaOnlineStatus(slug)
  );

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    fetch(`/api/personas/${slug}`)
      .then((res) => {
        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
          throw new Error("Not a JSON API endpoint");
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.name) {
          setPersona(data);
        } else {
          throw new Error("Invalid persona data structure");
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Error loading persona from API, using static default fallback:", err);
        const fallback = DEFAULT_PERSONAS.find(
          (p) => p.slug.toLowerCase() === slug?.toLowerCase()
        );
        if (fallback) {
          setPersona(fallback);
        }
        setLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    if (persona) {
      document.title = `${persona.name} - ${persona.occupation || "Profile"} | Dream Babe`;
      let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!canonicalLink) {
        canonicalLink = document.createElement("link");
        canonicalLink.rel = "canonical";
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.href = `https://dreambabe.pages.dev/dreamgirl/${persona.slug}`;
    }
    return () => {
      document.title = "Dream Babe";
    };
  }, [persona]);

  useEffect(() => {
    if (slug) {
      setStatus(getPersonaOnlineStatus(slug));
      const unsubscribe = subscribeToPersonaStatus((s, newStatus) => {
        if (s === slug.toLowerCase()) {
          setStatus(newStatus);
        }
      });
      return unsubscribe;
    }
  }, [slug]);

  const handleToggleStatus = () => {
    if (slug) {
      const updated = togglePersonaOnlineStatus(slug);
      setStatus(updated);
    }
  };

  const galleryImages = useMemo(() => {
    if (!persona) return [];
    const list: string[] = [];
    if (persona.profileImage) list.push(persona.profileImage);
    if (persona.coverImage) list.push(persona.coverImage);
    if (persona.gallery) {
      persona.gallery.split(",").forEach((url) => {
        const trimmed = url.trim();
        if (trimmed && !list.includes(trimmed)) list.push(trimmed);
      });
    }

    // If persona has no images configured, return empty array
    if (list.length === 0) {
      return [];
    }

    return list;
  }, [persona]);

  const personalityTags = useMemo(() => {
    if (!persona?.personality) return [];
    return persona.personality.split(",").map((p) => p.trim()).filter(Boolean);
  }, [persona]);

  // Personality traits with realistic ratings
  const personalityScores = useMemo(() => {
    if (!persona) return [];
    const seed = persona.name.length;
    return [
      { label: "Confidence", score: `${8 + (seed % 2)}/10`, emoji: "🔥" },
      { label: "Sensuality", score: "10/10", emoji: "💋" },
      { label: "Playfulness", score: `${9 - (seed % 2)}/10`, emoji: "😄" },
      { label: "Wild Desire", score: `${9 + (seed % 2)}/10`, emoji: "😈" },
      { label: "Intimacy", score: `${8 + (seed % 3)}/10`, emoji: "💖" }
    ];
  }, [persona]);

  // Interests map with icons
  const interestIcons: Record<string, any> = {
    Music: Music,
    Fashion: Shirt,
    Travel: Plane,
    Movies: Film,
    Food: Utensils,
    Photography: Camera,
    Technology: Laptop,
    Nightlife: Wine
  };

  const parsedInterests = useMemo(() => {
    if (!persona?.interests) {
      return [
        { label: "Sensual Teasing", icon: Flame },
        { label: "Silk Lingerie", icon: Shirt },
        { label: "Private Video Calls", icon: MessageSquare },
        { label: "Nightlife", icon: Wine },
        { label: "Erotic Whispers", icon: Sparkles }
      ];
    }
    return persona.interests
      .split(",")
      .map((i) => i.trim())
      .filter(Boolean)
      .map((label) => ({
        label,
        icon: interestIcons[label] || Sparkles
      }));
  }, [persona]);

  const navTabs = useMemo(() => {
    return [
      { id: "about", label: "About & Confessions", icon: User, target: "about-section" },
      { id: "physical", label: "Physical Attributes", icon: Sparkles, target: "physical-section" },
      { id: "intimacy", label: "Desires & Erotic", icon: Flame, target: "intimacy-section" },
      { id: "personality", label: "Personality", icon: Sun, target: "personality-section" },
      { id: "interests", label: "Interests & Hobbies", icon: Heart, target: "interests-section" },
      { id: "photos", label: galleryImages.length > 0 ? `Photos (${galleryImages.length})` : "Photos", icon: ImageIcon, target: "photos-section" },
      { id: "conversation", label: "Start Chat", icon: MessageSquare, target: "conversation" },
    ];
  }, [galleryImages]);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080e] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-pink-500/30 border-t-pink-500 animate-spin" />
      </div>
    );
  }

  if (!persona) {
    return (
      <div className="min-h-screen bg-[#07080e] text-white flex flex-col items-center justify-center p-6">
        <h1 className="text-xl font-bold mb-4">Dreamgirl Not Found</h1>
        {isPrivate ? (
          <p className="text-xs text-neutral-400">
            This profile is not available.
          </p>
        ) : (
          <Link
            to="/dreamgirls"
            className="px-5 py-2 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-xs font-semibold"
          >
            Explore Dreamgirls
          </Link>
        )}
      </div>
    );
  }

  // Display images in grid
  const fiveImages = galleryImages.slice(0, 5);

  const turnOnList = persona.turnOns
    ? persona.turnOns.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const turnOffList = persona.turnOffs
    ? persona.turnOffs.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const kinksList = persona.kinksAndFetishes
    ? persona.kinksAndFetishes.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const eroticInterestsList = persona.eroticInterests
    ? persona.eroticInterests.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="flex flex-col min-h-screen bg-[#07080e] text-neutral-100 selection:bg-pink-500/30">
      {/* TOP COMPACT HEADER BAR */}
      <div className="w-full bg-[#07080e]/95 border-b border-white/[0.08] sticky top-0 z-40 px-4 sm:px-8 py-2.5 backdrop-blur-xl flex items-center justify-between">
        {isPrivate ? (
          <span className="text-xs font-medium text-neutral-500">
            {persona.name}
          </span>
        ) : (
          <Link
            to="/dreamgirls"
            className="flex items-center gap-2 text-xs font-medium text-neutral-300 hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
            <span>Back to Dreamgirls</span>
          </Link>
        )}

        {/* Dynamic Status / Mode switch trigger */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleToggleStatus}
            title="Click to toggle Online/Offline mode"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs font-medium transition-all active:scale-95 cursor-pointer"
          >
            {status.isOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <span className="text-emerald-400 font-semibold">Online now</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                <span className="text-neutral-300">{status.statusText}</span>
              </>
            )}
            <RefreshCw className="w-2.5 h-2.5 text-neutral-400 opacity-60 ml-0.5" />
          </button>
        </div>
      </div>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-3 pb-16">
        {/* COMPACT HERO BANNER & PROFILE IDENTITY ROW */}
        <div className="relative w-full rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0c0e18] mb-6 shadow-xl">
          {/* BANNER COVER IMAGE */}
          <div className="relative h-36 sm:h-44 md:h-48 w-full bg-neutral-900 overflow-hidden">
            {persona.coverImage ? (
              <img
                src={persona.coverImage}
                alt={persona.name}
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-purple-950 via-neutral-900 to-pink-950" />
            )}

            {/* Gradient overlays */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0e18] via-[#0c0e18]/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0c0e18]/80 via-transparent to-transparent" />
          </div>

          {/* AVATAR + IDENTITY INFO OVERLAY */}
          <div className="px-5 pb-5 pt-1 sm:px-6 sm:pb-6 relative z-20 flex flex-col md:flex-row md:items-end justify-between gap-4 -mt-20 sm:-mt-24 md:-mt-28">
            {/* AVATAR & METADATA */}
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5">
              {/* Circular Avatar */}
              <div className="relative shrink-0">
                <div className="p-1.5 rounded-full bg-gradient-to-tr from-[#e1147a] via-[#ec4899] to-[#9333ea] shadow-2xl shadow-black/90">
                  <div className="w-32 h-32 sm:w-38 sm:h-38 md:w-44 md:h-44 rounded-full overflow-hidden border-4 border-[#0c0e18] bg-neutral-800">
                    {persona.profileImage ? (
                      <img
                        src={persona.profileImage}
                        alt={persona.name}
                        className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-300"
                        onClick={() => openLightbox(0)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-white font-bold text-4xl">
                        {persona.name.charAt(0)}
                      </div>
                    )}
                  </div>
                </div>
                {/* Online / Offline Dot */}
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  title={`Status: ${status.statusText}. Click to toggle.`}
                  className="cursor-pointer"
                >
                  {status.isOnline ? (
                    <span
                      className="absolute bottom-2.5 right-2.5 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-emerald-400 border-3 border-[#0c0e18] shadow-lg shadow-emerald-500/60 flex items-center justify-center"
                    >
                      <span className="w-3 h-3 rounded-full bg-white animate-ping opacity-75" />
                    </span>
                  ) : (
                    <span
                      className="absolute bottom-2.5 right-2.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-neutral-500 border-2 border-[#0c0e18]"
                    />
                  )}
                </button>
              </div>

              {/* Identity Details */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
                    {persona.name}
                  </h1>
                  {/* Verified Badge */}
                  <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center shadow-sm">
                    <CheckCircle2 className="w-3 h-3 text-white fill-current" />
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-pink-500/20 text-pink-400 border border-pink-500/30">
                    18+ Adult VIP
                  </span>
                </div>

                {/* Info String with Status */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300 font-medium">
                  <span className="text-neutral-400">@{persona.slug}</span>
                  <span className="text-neutral-600">•</span>
                  <span>{persona.age || 22} y/o</span>
                  <span className="text-neutral-600">•</span>
                  <span className="flex items-center gap-1 text-neutral-300">
                    <MapPin className="w-3 h-3 text-neutral-400" />
                    {[persona.city, persona.country].filter(Boolean).join(", ") || "United States"}
                  </span>
                  {persona.occupation && (
                    <>
                      <span className="text-neutral-600">•</span>
                      <span className="text-pink-300">{persona.occupation}</span>
                    </>
                  )}
                  <span className="text-neutral-600">•</span>
                  <span
                    onClick={handleToggleStatus}
                    className={`cursor-pointer hover:underline ${
                      status.isOnline ? "text-emerald-400 font-medium" : "text-neutral-400"
                    }`}
                  >
                    {status.statusText}
                  </span>
                </div>

                {/* Personality Tags Row */}
                {personalityTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {personalityTags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#131627] text-neutral-200 border border-purple-500/30"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ACTION BUTTONS (Start Call, Message, Heart) */}
            <div className="flex items-center gap-2.5 shrink-0 pt-1 md:pt-0">
              {/* Start Call CTA */}
              <button
                onClick={() => navigate(`/call/${persona.slug}`)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/25 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5 fill-current" />
                <span>Start Call</span>
              </button>

              {/* Message Button */}
              <button
                onClick={() => navigate(`/call/${persona.slug}?chat=true`)}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 active:scale-95 transition-all cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Message</span>
              </button>

              {/* Favorite Heart Button */}
              <button
                onClick={() => setIsFavorited(!isFavorited)}
                className={`w-9 h-9 rounded-full border border-white/15 flex items-center justify-center transition-all cursor-pointer ${
                  isFavorited
                    ? "bg-pink-500/20 border-pink-500/50 text-pink-400"
                    : "bg-white/[0.06] hover:bg-white/[0.12] text-neutral-300 hover:text-white"
                }`}
                title="Favorite"
              >
                <Heart className={`w-3.5 h-3.5 ${isFavorited ? "fill-current" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        {/* 3-COLUMN COMPACT LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* COLUMN 1: LEFT VERTICAL NAVIGATION (lg:col-span-3) */}
          <div className="lg:col-span-3 bg-[#0c0e18] border border-white/[0.08] rounded-xl p-1.5 sticky top-16 shadow-lg space-y-0.5">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === "conversation") {
                      navigate(`/call/${persona.slug}?chat=true`);
                    } else {
                      scrollToSection(tab.target);
                    }
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer ${
                    isActive
                      ? "bg-gradient-to-r from-purple-900/50 to-pink-900/20 text-white border-l-2 border-pink-500 shadow-inner"
                      : "text-neutral-400 hover:text-white hover:bg-white/[0.05]"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-pink-400" : "text-neutral-400"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* COLUMN 2: MIDDLE MAIN CONTENT (lg:col-span-5) */}
          <div className="lg:col-span-5 space-y-4">
            {/* ABOUT & SULTRY BIO CARD */}
            <div id="about-section" className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-4 sm:p-5 shadow-lg space-y-3.5">
              <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.06]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-pink-400" />
                  <span>Biography & Seduction</span>
                </h3>
                <span className="text-[11px] text-pink-400 font-medium">Verified VIP</span>
              </div>

              {/* Short Bio teaser */}
              {persona.shortBio && (
                <div className="p-2.5 rounded-lg bg-gradient-to-r from-pink-950/30 to-purple-950/20 border border-pink-500/20 text-xs italic text-pink-200">
                  "{persona.shortBio}"
                </div>
              )}

              {/* Bio description text / Long bio */}
              <div className="text-xs text-neutral-300 leading-relaxed space-y-2">
                <p>
                  {readMore || ((persona.longBio || persona.description || "").length <= 220)
                    ? (persona.longBio || persona.description)
                    : `${(persona.longBio || persona.description || "").slice(0, 220)}...`}
                </p>
                {(persona.longBio || persona.description || "").length > 220 && (
                  <button
                    onClick={() => setReadMore(!readMore)}
                    className="text-pink-400 hover:text-pink-300 text-xs font-semibold inline-flex items-center gap-1 pt-1 cursor-pointer"
                  >
                    <span>{readMore ? "Read Less" : "Read Full Story"}</span>
                    {readMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
              </div>

              {/* Quick specs grid */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.05]">
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <span className="text-[10px] uppercase font-bold text-neutral-500 block">Location</span>
                  <span className="text-xs font-semibold text-white">
                    {[persona.city, persona.country].filter(Boolean).join(", ") || "United States"}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <span className="text-[10px] uppercase font-bold text-neutral-500 block">Languages</span>
                  <span className="text-xs font-semibold text-white">
                    {persona.languages || "English"}
                  </span>
                </div>
              </div>
            </div>

            {/* PHYSICAL ATTRIBUTES CARD */}
            <div id="physical-section" className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                  <span>Physical Attributes</span>
                </h3>
                <span className="text-[10px] text-pink-400/80 font-semibold uppercase">Measurements & Look</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {persona.bodyType && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-pink-400" />
                      Body Type
                    </span>
                    <span className="text-xs font-semibold text-white mt-0.5 block">
                      {persona.bodyType}
                    </span>
                  </div>
                )}

                {persona.bustSize && (
                  <div className="p-2.5 rounded-lg bg-pink-950/20 border border-pink-500/20">
                    <span className="text-[10px] uppercase font-bold text-pink-400 block flex items-center gap-1">
                      <Heart className="w-2.5 h-2.5 fill-current" />
                      Bust Size
                    </span>
                    <span className="text-xs font-bold text-pink-200 mt-0.5 block">
                      {persona.bustSize}
                    </span>
                  </div>
                )}

                {persona.height && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                      <Ruler className="w-2.5 h-2.5 text-purple-400" />
                      Height
                    </span>
                    <span className="text-xs font-semibold text-white mt-0.5 block">
                      {persona.height}
                    </span>
                  </div>
                )}

                {persona.eyeColor && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                      <Eye className="w-2.5 h-2.5 text-blue-400" />
                      Eyes
                    </span>
                    <span className="text-xs font-semibold text-white mt-0.5 block">
                      {persona.eyeColor}
                    </span>
                  </div>
                )}

                {persona.hairColor && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                      <Feather className="w-2.5 h-2.5 text-amber-400" />
                      Hair
                    </span>
                    <span className="text-xs font-semibold text-white mt-0.5 block">
                      {persona.hairColor}
                    </span>
                  </div>
                )}

                {persona.tattoosAndPiercings && (
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] col-span-2">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                      Tattoos & Piercings
                    </span>
                    <span className="text-xs font-semibold text-white mt-0.5 block">
                      {persona.tattoosAndPiercings}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* DESIRES & SPECIALIZED EROTIC INTERESTS CARD */}
            <div id="intimacy-section" className="bg-[#0c0e18] border border-pink-500/20 rounded-xl p-4 sm:p-5 shadow-lg space-y-3.5 bg-gradient-to-b from-[#0c0e18] via-[#120f1f]/50 to-[#0c0e18]">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-pink-300 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-pink-400 fill-pink-500/20" />
                  <span>Desires & Specialized Erotic Interests</span>
                </h3>
                <span className="text-[10px] text-pink-400 font-bold uppercase">Adult Flirty</span>
              </div>

              {/* Intimacy Style & Preferred Vibe */}
              {(persona.intimacyStyle || persona.preferredVibe) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {persona.intimacyStyle && (
                    <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-[10px] uppercase font-bold text-neutral-400 block">Intimacy Style</span>
                      <span className="text-xs font-semibold text-pink-300 mt-0.5 block">
                        {persona.intimacyStyle}
                      </span>
                    </div>
                  )}
                  {persona.preferredVibe && (
                    <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-[10px] uppercase font-bold text-neutral-400 block">Preferred Vibe</span>
                      <span className="text-xs font-semibold text-purple-300 mt-0.5 block">
                        {persona.preferredVibe}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Turn-Ons */}
              {turnOnList.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                    <Flame className="w-3 h-3 text-pink-500" />
                    Turn-Ons
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {turnOnList.map((item, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-pink-500/10 text-pink-200 border border-pink-500/30"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Kinks & Fetishes */}
              {kinksList.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                    <Lock className="w-3 h-3 text-purple-400" />
                    Kinks & Fetishes
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {kinksList.map((item, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-purple-500/10 text-purple-200 border border-purple-500/30"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Favorite Lingerie */}
              {persona.favoriteLingerie && (
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                    <Shirt className="w-3 h-3 text-pink-400" />
                    Favorite Lingerie
                  </span>
                  <p className="text-xs text-neutral-200 italic leading-relaxed">
                    {persona.favoriteLingerie}
                  </p>
                </div>
              )}

              {/* Specialized Erotic Interests (Cam, Tease, Shows) */}
              {eroticInterestsList.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-pink-400" />
                    Specialized Erotic Interests
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {eroticInterestsList.map((item, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.05] text-neutral-200 border border-white/10"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Private Fantasies */}
              {persona.fantasies && (
                <div className="p-3 rounded-lg bg-gradient-to-r from-purple-950/40 via-pink-950/20 to-neutral-900 border border-purple-500/30 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-pink-300 block flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-pink-400" />
                    Forbidden Fantasy
                  </span>
                  <p className="text-xs text-neutral-200 italic leading-relaxed">
                    "{persona.fantasies}"
                  </p>
                </div>
              )}

              {/* Turn-Offs */}
              {turnOffList.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-white/[0.05]">
                  <span className="text-[10px] uppercase font-bold text-neutral-500 block">
                    Turn-Offs
                  </span>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    {turnOffList.join(" • ")}
                  </p>
                </div>
              )}
            </div>

            {/* PERSONALITY SCORES CARD */}
            <div id="personality-section" className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 pb-2 border-b border-white/[0.06] flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Personality & Allure</span>
              </h3>
              <div className="space-y-2.5">
                {personalityScores.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-300 flex items-center gap-1.5">
                      <span>{item.emoji}</span>
                      <span>{item.label}</span>
                    </span>
                    <span className="font-semibold text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded-md border border-pink-500/20">
                      {item.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* INTERESTS CHIPS CARD */}
            <div id="interests-section" className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 pb-2 border-b border-white/[0.06] flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-pink-400" />
                <span>Interests & Hobbies</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {parsedInterests.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-neutral-200 hover:border-pink-500/30 transition-colors"
                    >
                      <Icon className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* COLUMN 3: RIGHT PHOTOS SECTION (Only images visible on profile) */}
          <div className="lg:col-span-4 space-y-4" id="photos-section">
            {galleryImages.length > 0 ? (
              <div className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-4 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
                    <span>Photo Gallery ({galleryImages.length} Photos)</span>
                  </h3>
                  <span className="text-[10px] text-neutral-400 font-medium">Verified Photos</span>
                </div>

                {/* 5-Image Grid Layout */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      onClick={() => openLightbox(0)}
                      className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-[3/4] cursor-pointer group border border-white/[0.06]"
                    >
                      <img
                        src={fiveImages[0]}
                        alt="Photo 1"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/15 group-hover:bg-transparent transition-colors" />
                    </div>

                    <div className="flex flex-col gap-2">
                      {fiveImages[1] && (
                        <div
                          onClick={() => openLightbox(1)}
                          className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-[4/3] cursor-pointer group border border-white/[0.06] flex-1"
                        >
                          <img
                            src={fiveImages[1]}
                            alt="Photo 2"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      )}
                      {fiveImages[2] && (
                        <div
                          onClick={() => openLightbox(2)}
                          className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-[4/3] cursor-pointer group border border-white/[0.06] flex-1"
                        >
                          <img
                            src={fiveImages[2]}
                            alt="Photo 3"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {(fiveImages[3] || fiveImages[4]) && (
                    <div className="grid grid-cols-2 gap-2">
                      {fiveImages[3] && (
                        <div
                          onClick={() => openLightbox(3)}
                          className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-[4/3] cursor-pointer group border border-white/[0.06]"
                        >
                          <img
                            src={fiveImages[3]}
                            alt="Photo 4"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      )}
                      {fiveImages[4] && (
                        <div
                          onClick={() => openLightbox(4)}
                          className="relative rounded-lg overflow-hidden bg-neutral-800 aspect-[4/3] cursor-pointer group border border-white/[0.06]"
                        >
                          <img
                            src={fiveImages[4]}
                            alt="Photo 5"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <a
                  href="https://fanve.pages.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-3.5 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-95 text-center cursor-pointer"
                >
                  <span>View All</span>
                  <ExternalLink className="w-3.5 h-3.5 text-white shrink-0" />
                </a>
              </div>
            ) : (
              <div className="bg-[#0c0e18] border border-white/[0.08] rounded-xl p-5 shadow-lg text-center">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.06]">
                  <h3 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
                    <span>Photos</span>
                  </h3>
                  <span className="text-[10px] text-neutral-500 font-medium">Gallery</span>
                </div>
                <div className="py-8 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3 text-neutral-500">
                    <ImageIcon className="w-5 h-5 text-neutral-400" />
                  </div>
                  <p className="text-xs font-semibold text-neutral-300 mb-1">No photos uploaded yet</p>
                  <p className="text-[11px] text-neutral-500 max-w-[200px]">Profile photos will be displayed here once provided.</p>
                </div>
                <a
                  href="https://fanve.pages.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 shadow-md shadow-pink-500/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-95 text-center cursor-pointer"
                >
                  <span>View All</span>
                  <ExternalLink className="w-3.5 h-3.5 text-white shrink-0" />
                </a>
              </div>
            )}


          </div>
        </div>
      </main>

      {/* FULLSCREEN LIGHTBOX MODAL */}
      <AnimatePresence>
        {lightboxOpen && fiveImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-[102] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="absolute top-4 left-4 text-xs font-semibold text-white/70">
              {persona.name} • Photo {lightboxIndex + 1} of {fiveImages.length}
            </div>

            {fiveImages.length > 1 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex((prev) => (prev - 1 + fiveImages.length) % fiveImages.length);
                  }}
                  className="absolute left-3 sm:left-6 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white z-[102] cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex((prev) => (prev + 1) % fiveImages.length);
                  }}
                  className="absolute right-3 sm:right-6 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white z-[102] cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}

            <div className="relative max-w-3xl max-h-[80vh] p-2 select-none" onClick={(e) => e.stopPropagation()}>
              <img
                src={fiveImages[lightboxIndex]}
                alt={`Photo ${lightboxIndex + 1}`}
                referrerPolicy="no-referrer"
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="max-w-full max-h-[75vh] object-contain rounded-xl shadow-2xl border border-white/10"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FOOTER — hidden in private mode: it links to the home page and the grid */}
      {!isPrivate && <Footer />}
    </div>
  );
}

