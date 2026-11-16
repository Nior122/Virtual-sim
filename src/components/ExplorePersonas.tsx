import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Persona } from "../types";
import { DEFAULT_PERSONAS } from "../data/defaultPersonas";
import { Search, SlidersHorizontal, X, MapPin, Sparkles, Shuffle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "./Navbar";
import PersonaCard from "./PersonaCard";
import Footer from "./Footer";
import NativeAd from "./NativeAd";

export default function ExplorePersonas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [personas, setPersonas] = useState<Persona[]>(() => DEFAULT_PERSONAS);
  const [loading, setLoading] = useState(false);

  // Search and Filters
  const initialQuery = searchParams.get("q") || "";
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedLocation, setSelectedLocation] = useState<string>("All");
  const [selectedPersonality, setSelectedPersonality] = useState<string>("All");
  const [selectedInterest, setSelectedInterest] = useState<string>("All");
  const [selectedOccupation, setSelectedOccupation] = useState<string>("All");

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
          setPersonas(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Using default personas fallback:", err);
        setPersonas(DEFAULT_PERSONAS);
        setLoading(false);
      });
  }, []);

  const triggerShuffle = () => {
    setPersonas((prev) => {
      if (prev.length <= 1) return prev;
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  };

  // Automatic Reshuffle every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      triggerShuffle();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Update query when search param changes
  useEffect(() => {
    const q = searchParams.get("q");
    if (q !== null && q !== searchQuery) {
      setSearchQuery(q);
    }
  }, [searchParams]);

  // Compute unique filter options
  const locations = useMemo(() => {
    const set = new Set<string>();
    personas.forEach((p) => {
      if (p.city) set.add(p.city);
      if (p.country) set.add(p.country);
    });
    return ["All", ...Array.from(set)];
  }, [personas]);

  const personalities = useMemo(() => {
    const set = new Set<string>();
    personas.forEach((p) => {
      if (p.personality) {
        p.personality.split(",").forEach((t) => set.add(t.trim()));
      }
    });
    return ["All", ...Array.from(set).slice(0, 10)];
  }, [personas]);

  const interestsList = useMemo(() => {
    const set = new Set<string>();
    personas.forEach((p) => {
      if (p.interests) {
        p.interests.split(",").forEach((i) => set.add(i.trim()));
      }
    });
    return ["All", ...Array.from(set).slice(0, 10)];
  }, [personas]);

  // Filter logic
  const filteredPersonas = useMemo(() => {
    return personas.filter((p) => {
      const pLoc = [p.city, p.country].filter(Boolean).join(", ").toLowerCase();
      const pInterests = p.interests ? p.interests.toLowerCase() : "";
      const pPersonality = p.personality ? p.personality.toLowerCase() : "";
      const pOccupation = p.occupation ? p.occupation.toLowerCase() : "";

      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        pLoc.includes(query) ||
        pPersonality.includes(query) ||
        pInterests.includes(query) ||
        (p.shortBio && p.shortBio.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query));

      const matchesLocation =
        selectedLocation === "All" ||
        pLoc.includes(selectedLocation.toLowerCase()) ||
        (p.city && p.city.toLowerCase() === selectedLocation.toLowerCase()) ||
        (p.country && p.country.toLowerCase() === selectedLocation.toLowerCase());

      const matchesPersonality =
        selectedPersonality === "All" ||
        pPersonality.includes(selectedPersonality.toLowerCase());

      const matchesInterest =
        selectedInterest === "All" ||
        pInterests.includes(selectedInterest.toLowerCase());

      const matchesOccupation =
        selectedOccupation === "All" ||
        pOccupation.includes(selectedOccupation.toLowerCase());

      return (
        matchesSearch &&
        matchesLocation &&
        matchesPersonality &&
        matchesInterest &&
        matchesOccupation
      );
    });
  }, [
    personas,
    searchQuery,
    selectedLocation,
    selectedPersonality,
    selectedInterest,
    selectedOccupation
  ]);

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedLocation("All");
    setSelectedPersonality("All");
    setSelectedInterest("All");
    setSelectedOccupation("All");
    setSearchParams({});
  };

  const hasActiveFilters =
    searchQuery !== "" ||
    selectedLocation !== "All" ||
    selectedPersonality !== "All" ||
    selectedInterest !== "All" ||
    selectedOccupation !== "All";

  return (
    <div className="flex flex-col min-h-screen bg-[#07080e] text-neutral-100 selection:bg-pink-500/30">
      <Navbar onSearchChange={(q) => setSearchQuery(q)} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* HEADER */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-pink-400 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Explore Verified Dreamgirls</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Discover Dreamgirls
            </h1>
            <p className="text-neutral-400 text-sm mt-1">
              Connect with verified Dreamgirls and companions for 1-on-1 video calls and messaging.
            </p>
          </div>

          {/* SEARCH BOX */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value) {
                  setSearchParams({ q: e.target.value });
                } else {
                  setSearchParams({});
                }
              }}
              placeholder="Search by name, city, interest..."
              className="w-full bg-[#0d0f1a] border border-white/[0.08] focus:border-pink-500/50 rounded-full pl-10 pr-9 py-2 text-xs text-white placeholder:text-neutral-500 outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchParams({});
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* FILTER CHIPS ROW */}
        <div className="mb-8 space-y-3 bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-pink-400" />
              <span>Filter by Category</span>
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-xs text-pink-400 hover:text-pink-300 font-medium"
              >
                Reset All Filters
              </button>
            )}
          </div>

          {/* Filter Row: Locations */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-[11px] text-neutral-500 font-medium shrink-0 mr-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Location:
            </span>
            {locations.map((loc) => (
              <button
                key={loc}
                onClick={() => setSelectedLocation(loc)}
                className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-all ${
                  selectedLocation === loc
                    ? "bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold shadow-sm"
                    : "bg-white/[0.04] text-neutral-400 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                {loc}
              </button>
            ))}
          </div>

          {/* Filter Row: Personality */}
          {personalities.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[11px] text-neutral-500 font-medium shrink-0 mr-1">
                Vibe:
              </span>
              {personalities.map((trait) => (
                <button
                  key={trait}
                  onClick={() => setSelectedPersonality(trait)}
                  className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-all ${
                    selectedPersonality === trait
                      ? "bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold shadow-sm"
                      : "bg-white/[0.04] text-neutral-400 hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {trait}
                </button>
              ))}
            </div>
          )}

          {/* Filter Row: Interests */}
          {interestsList.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[11px] text-neutral-500 font-medium shrink-0 mr-1">
                Interests:
              </span>
              {interestsList.map((interest) => (
                <button
                  key={interest}
                  onClick={() => setSelectedInterest(interest)}
                  className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 transition-all ${
                    selectedInterest === interest
                      ? "bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold shadow-sm"
                      : "bg-white/[0.04] text-neutral-400 hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {interest}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RESULTS COUNT */}
        <div className="flex items-center justify-between gap-3 mb-6 text-xs text-neutral-400">
          <div>
            Showing <strong className="text-white">{filteredPersonas.length}</strong> available{" "}
            {filteredPersonas.length === 1 ? "persona" : "personas"}
          </div>
        </div>

        {/* LOADING STATE */}
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-pink-500/30 border-t-pink-500 animate-spin" />
            <p className="text-xs text-neutral-500">Loading personas...</p>
          </div>
        ) : filteredPersonas.length > 0 ? (
          /* PERSONAS GRID */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredPersonas.map((persona) => (
              <div key={persona.id} className="h-full">
                <PersonaCard persona={persona} />
              </div>
            ))}
          </div>
        ) : (
          /* EMPTY STATE */
          <div className="py-20 flex flex-col items-center justify-center text-center px-4 bg-[#0d0f1a] border border-white/[0.06] rounded-3xl">
            <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-4 text-neutral-500">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">No personas found</h3>
            <p className="text-xs text-neutral-400 max-w-sm mb-5">
              We couldn't find any personas matching your active search or filters. Try adjusting your criteria.
            </p>
            <button
              onClick={clearAllFilters}
              className="px-5 py-2 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-600 shadow-md shadow-pink-500/20"
            >
              Reset All Filters
            </button>
          </div>
        )}
      </main>

      {/* In-page advert: owner's network code, or the house banner. Sits in the
          normal flow at the bottom of the page, directly above the footer. */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <NativeAd />
      </div>

      <Footer />
    </div>
  );
}
