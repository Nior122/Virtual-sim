import { useEffect, useState, useRef, FormEvent, ChangeEvent } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { usePrivateMode } from "../hooks/useSiteMode";
import Hls from "hls.js";
import { Persona, ChatMessage, CallState, CALL_CONFIG, PersonaVideo } from "../types";
import { DEFAULT_PERSONAS } from "../data/defaultPersonas";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  MessageSquare,
  Send,
  Loader2,
  Volume2,
  VolumeX,
  Maximize2,
  Home,
  User,
  ArrowLeftRight,
  ChevronLeft,
  Check,
  CheckCheck,
  Smile,
  Info,
  Paperclip,
  X,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Image as ImageIcon,
  Timer,
} from "lucide-react";
import PersonaChatProfileModal from "./PersonaChatProfileModal";
import {
  getPersonaOnlineStatus,
  setPersonaOnlineStatus,
  togglePersonaOnlineStatus,
  subscribeToPersonaStatus,
  PersonaOnlineStatus,
} from "../utils/personaStatus";
import {
  isMediaOrImageRequest,
  isVideoRequest,
  isSocialMediaOrContactRequest,
  isWhatsAppOrContactRequest,
  isAdultWordMentioned,
  hasSubstantialNonAdultMeaning,
  isPureAdultWordOnly,
  getAdultWordPlayfulResponse,
  selectProfileImageForChat,
  PHOTO_REPLY_CAPTIONS,
  VIDEO_REQUEST_IMAGE_CAPTIONS,
  MAX_PHOTOS_PER_CHAT,
  PHOTO_LIMIT_EXCEEDED_MESSAGES,
  isManagerRequest,
  getManagerTelegramMessage,
  isAdultPictureRequest,
  getAdultPictureManagerRejectionMessage,
  isMeetUpOrDateRequest,
  getMeetUpOrDateManagerTelegramMessage,
  getSocialMediaManagerTelegramMessage,
  getWhatsAppManagerTelegramMessage,
  sanitizeHumanChatOutput,
} from "../utils/mediaRequest";
import { evaluateMiniTaskAgent, getRandomMissedOrRejectedCallMessage } from "../utils/taskAgent";
import { fetchCallAccess, postConnectedCall, type CallAccessState } from "../lib/calls/client";
import { toPlaybackUrl } from "../lib/video/playback";
import {
  findManagerLink,
  hasManagerLink,
  managerHandle,
  managerLinkText,
  managerLinkUrl,
  setManagerTelegram,
  splitManagerLinks,
} from "../lib/manager";
import { IncomingCallModal } from "./IncomingCallModal";
import { CallBlockedScreen } from "./CallBlockedScreen";

interface PendingAttachment {
  file: File;
  previewUrl: string;
  name: string;
  type: "image" | "video" | "file";
}

const SHOCKING_LOVE_IT_MESSAGES = [
  "OMG wait... 😳 WOW I love this!! You're killing me right now 🔥",
  "HOLY... are you trying to give me a heart attack?! 😍 I'm literally obsessed with this!",
  "WAIT... NO WAY! 🙈 That just took my breath away, I LOVE IT so much!",
  "Woah... my jaw actually just dropped 🫢💕 How are you this breathtaking?!",
  "STOP IT right now! 🥵 I am completely in love with this... send me more!",
  "Oh wow... 😳 I wasn't ready for that! I absolutely LOVE IT ❤️",
  "Excuse me?! 🫦 My heart just skipped a whole beat! I love this so damn much!",
  "OMG you look unreal... 💖 I cannot stop staring at this, I love it!",
  "NO SHUT UP! 😱 Are you serious right now?! I am so in love with this!",
  "A whole masterpiece... 🤤 Got me blushing like crazy over here! Love it!",
];

export default function CallSession() {
  
  const { slug } = useParams();
  const navigate = useNavigate();
  /**
   * Private mode: the home page, /dreamgirls and /personas do not exist for
   * this visitor, so "Home" / "Back" return to this profile instead of a 404.
   * The server enforces the same rule; this only keeps the buttons sane.
   */
  const isPrivate = usePrivateMode();
  const [searchParams] = useSearchParams();
  const isChatParam = searchParams.get("chat") === "true";
  const [persona, setPersona] = useState<Persona | null>(null);
  const [callState, setCallState] = useState<CallState>(() =>
    isChatParam ? "IDLE" : "CONNECTING"
  );
  const callStateRef = useRef<CallState>(isChatParam ? "IDLE" : "CONNECTING");

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // -------------------------------------------------------------------------
  // Call regulator (one call per profile every 2h, five calls every 5h).
  // The server owns the numbers; this component only asks before ringing and
  // reports the call once the video is actually playing.
  // -------------------------------------------------------------------------
  const [callAccess, setCallAccess] = useState<CallAccessState | null>(null);
  /** "network" = the old busy screen, otherwise the regulator is blocking. */
  const [busyKind, setBusyKind] = useState<"network" | "cooldown" | "limit">("network");
  /** Ticks once a second while a countdown is on screen. */
  const [clockTick, setClockTick] = useState(() => Date.now());
  const serverSkewRef = useRef(0);
  /** True once this call has been counted, so one call never costs two. */
  const countedCallRef = useRef(false);
  /** Guards against a double-click starting two calls at once. */
  const beginCallBusyRef = useRef(false);

  const applyAccessState = (state: CallAccessState) => {
    serverSkewRef.current = state.now - Date.now();
    setCallAccess(state);
  };

  /** Milliseconds left before the blocked call becomes possible again. */
  const retryInMs = () => {
    if (!callAccess || callAccess.allowed || !callAccess.retryAt) return 0;
    return Math.max(0, callAccess.retryAt - (clockTick + serverSkewRef.current));
  };

  useEffect(() => {
    if (busyKind === "network") return;
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busyKind]);

  const nextVideoTimeoutRef = useRef<any>(null);
  const videoSafetyTimeoutRef = useRef<any>(null);
  const pickupDelayTimeoutRef = useRef<any>(null);
  const missedCallTypingTimeoutRef = useRef<any>(null);
  const missedCallMessageTimeoutRef = useRef<any>(null);
  const [chatOpen, setChatOpen] = useState(isChatParam);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [chatImageLightbox, setChatImageLightbox] = useState<string | null>(null);
  const [incomingCallData, setIncomingCallData] = useState<{
    persona: Persona;
    reason?: "prove_not_bot" | "call_request";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Online Status & Mode Switching
  const [onlineStatus, setOnlineStatus] = useState<PersonaOnlineStatus>(() =>
    getPersonaOnlineStatus(slug)
  );
  const pendingOfflineRepliesRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (slug) {
      setOnlineStatus(getPersonaOnlineStatus(slug));
      const unsubscribe = subscribeToPersonaStatus((s, newStatus) => {
        if (s === slug.toLowerCase()) {
          setOnlineStatus(newStatus);
          if (newStatus.isOnline && pendingOfflineRepliesRef.current.length > 0) {
            const queued = [...pendingOfflineRepliesRef.current];
            pendingOfflineRepliesRef.current = [];
            queued.forEach((fn) => fn());
          }
        }
      });
      return unsubscribe;
    }
  }, [slug]);

  const handleToggleOnlineStatus = () => {
    if (slug) {
      const updated = togglePersonaOnlineStatus(slug);
      setOnlineStatus(updated);
    }
  };

  // Audio Context for synthetic sounds
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<number | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
  };

  const playTone = (freq1: number, freq2: number, duration: number, startTimeOffset = 0) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const startTime = ctx.currentTime + startTimeOffset;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";
    osc1.frequency.setValueAtTime(freq1, startTime);
    osc2.frequency.setValueAtTime(freq2, startTime);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(startTime);
    osc2.start(startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.1, startTime + 0.05);
    gain.gain.setValueAtTime(0.1, startTime + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc1.stop(startTime + duration);
    osc2.stop(startTime + duration);
  };

  const startRinging = () => {
    initAudio();
    const ring = () => {
      // European/UK style double ring pattern
      playTone(400, 450, 0.4, 0);
      playTone(400, 450, 0.4, 0.6);
    };
    ring();
    ringIntervalRef.current = window.setInterval(ring, 3000);
  };

  const stopRinging = () => {
    if (ringIntervalRef.current !== null) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
  };

  const playPickup = () => {
    initAudio();
    playTone(800, 800, 0.1, 0);
    playTone(1200, 1200, 0.15, 0.1);
  };

  const playHangup = () => {
    initAudio();
    playTone(400, 400, 0.1, 0);
    playTone(400, 400, 0.1, 0.2);
    playTone(400, 400, 0.1, 0.4);
  };

  const playBusyTone = () => {
    initAudio();
    playTone(480, 620, 0.25, 0);
    playTone(480, 620, 0.25, 0.5);
    playTone(480, 620, 0.25, 1.0);
  };

  // Resume audio on interaction
  useEffect(() => {
    const handleInteraction = () => {
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume();
      }
    };
    document.addEventListener("click", handleInteraction);
    return () => document.removeEventListener("click", handleInteraction);
  }, []);

  // Screen layout: 'local' (user camera is full screen) or 'remote' (persona video is full screen)
  const [activeFullView, setActiveFullView] = useState<"local" | "remote">("local");
  const hasAutoSwitched = useRef(false);

  // Call duration counter
  const [callDuration, setCallDuration] = useState(0);

  // Video state
  const [videos, setVideos] = useState<PersonaVideo[]>([]);
  const [currentVideo, setCurrentVideo] = useState<PersonaVideo | null>(null);
  const [isRemoteVideoPlaying, setIsRemoteVideoPlaying] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const currentVideoRef = useRef<PersonaVideo | null>(null);
  const initialPersonaVideosRef = useRef<PersonaVideo[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const ringingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [muted, setMuted] = useState(false); // Mic mute
  const [audioEnabled, setAudioEnabled] = useState(true); // Remote audio sound
  const [videoFitMode, setVideoFitMode] = useState<"cover" | "contain">("contain");

  // Local Camera State
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Auto-dismiss camera notice after 6 seconds
  useEffect(() => {
    if (!cameraNotice) return;
    const timer = setTimeout(() => {
      setCameraNotice(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [cameraNotice]);

  // Clean up media stream, Hls instance, and videos ONLY on genuine component unmount
  useEffect(() => {
    return () => {
      callStateRef.current = "ENDED";
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
          hlsRef.current = null;
        } catch (e) {}
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
          videoRef.current.removeAttribute("src");
          videoRef.current.load();
        } catch (e) {}
      }
      if (nextVideoTimeoutRef.current) clearTimeout(nextVideoTimeoutRef.current);
      if (videoSafetyTimeoutRef.current) clearTimeout(videoSafetyTimeoutRef.current);
      if (pickupDelayTimeoutRef.current) clearTimeout(pickupDelayTimeoutRef.current);
      if (missedCallTypingTimeoutRef.current) clearTimeout(missedCallTypingTimeoutRef.current);
      if (missedCallMessageTimeoutRef.current) clearTimeout(missedCallMessageTimeoutRef.current);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      stopRinging();
    };
  }, []);

  // Keep stream attached to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, cameraEnabled, activeFullView]);

  const toggleCamera = async () => {
    if (cameraEnabled) {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      localStreamRef.current = null;
      setLocalStream(null);
      setCameraEnabled(false);
      setCameraNotice(null);
    } else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraNotice("Camera is not supported on this browser or device.");
        return;
      }
      setIsCameraStarting(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraEnabled(true);
        setCameraNotice(null);
        setIsCameraStarting(false);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: any) {
        setIsCameraStarting(false);
        const isDenied =
          err?.name === "NotAllowedError" ||
          err?.name === "PermissionDeniedError" ||
          (err?.message && String(err.message).toLowerCase().includes("denied"));
        console.warn("Camera access denied or unavailable:", err?.name || err?.message);
        setCameraNotice(
          isDenied
            ? "Camera permission was denied in your browser. You can continue the call with camera off, or allow camera permissions in your browser."
            : "Unable to access camera. Please check your camera settings."
        );
        setCameraEnabled(false);
      }
    }
  };

  const toggleScreenSwap = () => {
    setActiveFullView((prev) => (prev === "remote" ? "local" : "remote"));
  };

  // Chat state
  useEffect(() => {
    const checkExpiry = setInterval(() => {
      const stored = localStorage.getItem("chat_" + slug);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Date.now() - parsed.savedAt >= 20 * 60 * 1000) {
            localStorage.removeItem("chat_" + slug);
            setMessages([]);
          }
        } catch (e) {}
      }
    }, 60000); // check every minute
    return () => clearInterval(checkExpiry);
  }, [slug]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("chat_" + slug);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.savedAt < 20 * 60 * 1000) {
          // Valid within 20 mins
          return parsed.messages.map((m: any) => ({
             ...m,
             timestamp: new Date(m.timestamp)
          }));
        } else {
          // Expired, delete it
          localStorage.removeItem("chat_" + slug);
        }
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });
  
  // Save to localStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      const msgsToSave = messages.map(m => {
        // Strip media url
        const { attachmentUrl, ...rest } = m;
        // if it had an image, keep track of it so count works
        if (attachmentUrl || m.wasImage) {
           (rest as any).wasImage = true;
        }
        return rest;
      });
      localStorage.setItem("chat_" + slug, JSON.stringify({
        savedAt: Date.now(),
        messages: msgsToSave
      }));
    }
  }, [messages, slug]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState<false | "typing" | "sending_image">(false);
  const [activeReactionMenuMsgId, setActiveReactionMenuMsgId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const EMOJI_LIST = ["❤️", "🔥", "😏", "😂", "😍", "💋", "✨", "👍"];

  const toggleUserReaction = (msgId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const current = m.reactions || [];
        const existingUserReaction = current.find((r) => r.by === "user" && r.emoji === emoji);
        if (existingUserReaction) {
          return {
            ...m,
            reactions: current.filter((r) => !(r.by === "user" && r.emoji === emoji)),
          };
        } else {
          return {
            ...m,
            reactions: [...current, { emoji, by: "user" }],
          };
        }
      })
    );
    setActiveReactionMenuMsgId(null);
  };

  const groupReactions = (reactions: ChatMessage["reactions"] = []) => {
    const map = new Map<string, { count: number; hasUser: boolean; hasAssistant: boolean }>();
    reactions.forEach((r) => {
      const existing = map.get(r.emoji) || { count: 0, hasUser: false, hasAssistant: false };
      existing.count += 1;
      if (r.by === "user") existing.hasUser = true;
      if (r.by === "assistant") existing.hasAssistant = true;
      map.set(r.emoji, existing);
    });
    return Array.from(map.entries());
  };

  // Ad link redirect state: first send click directs to link, second send click sends message then resets
  const AD_REDIRECT_URL = "https://www.profitableratecpmnetwork.com/a3cptaygun?key=688309bf3a231ec0d6225f4236716aef";
  const canSendAfterAdRef = useRef(false);

  const openAdLink = () => {
    try {
      const opened = window.open(AD_REDIRECT_URL, "_blank", "noopener,noreferrer");
      if (!opened || opened.closed || typeof opened.closed === "undefined") {
        const link = document.createElement("a");
        link.href = AD_REDIRECT_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error("Ad redirect error:", err);
      window.open(AD_REDIRECT_URL, "_blank");
    }
  };

  useEffect(() => {
    if (!inputMessage.trim()) {
      canSendAfterAdRef.current = false;
    }
  }, [inputMessage]);


  // Initialize Persona on mount; only trigger call if not opened in chat-only mode
  useEffect(() => {
    let mounted = true;

    fetch(`/api/personas/${slug}`)
      .then((res) => {
        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
          throw new Error("Not JSON endpoint");
        }
        return res.json();
      })
      .catch((err) => {
        console.warn("CallSession: persona fetch error, checking local personas:", err);
        const fallback =
          DEFAULT_PERSONAS.find(
            (p) => p.slug.toLowerCase() === slug?.toLowerCase()
          ) || null;
        return fallback;
      })
      .then((data) => {
        if (!mounted || !data) return;
        setPersona(data);
        if (!isChatParam) {
          // Ask the regulator before ringing: a client who used their calls
          // must see the busy / limit screen, not a phone that never answers.
          void beginCall(data);
        }
      });

    return () => {
      mounted = false;
      stopRinging();
    };
  }, [slug, isChatParam]);

  // Call duration timer
  useEffect(() => {
    if (callState !== "VIDEO_PLAYING") return;
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [callState]);

  const isEmbedVideoUrl = (url?: string | null): boolean => {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes("rubyvidhub") || u.includes("morencius") || u.includes("embed") || u.includes(".html");
  };

  const getAutoplayEmbedUrl = (url?: string | null): string => {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("autoplay", "1");
      parsed.searchParams.set("auto", "1");
      parsed.searchParams.set("play", "1");
      return parsed.toString();
    } catch (e) {
      const joinChar = url.includes("?") ? "&" : "?";
      return `${url}${joinChar}autoplay=1&auto=1&play=1`;
    }
  };

  /**
   * Every remote video is played through our own Pages Functions
   * (/api/video-proxy, /api/hls-proxy) so hotlink-protected CDNs, missing CORS
   * headers and HTML embeds all work. Telegram media stays on /api/media.
   */
  const playbackUrlFor = (video: PersonaVideo | null | undefined): string => {
    if (!video) return "";
    const stream = (video.streamUrl || "").trim();
    if (stream.startsWith("/api/")) return stream;
    const raw = (video.url || stream || "").trim();
    if (!raw) return "";
    if (raw.startsWith("/api/")) return raw;
    return toPlaybackUrl(raw);
  };

  // Programmatic direct stream playback with HLS support for clean, natural video without player UI
  useEffect(() => {
    if (!currentVideo) return;
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING") return;

    currentVideoRef.current = currentVideo;
    let isMounted = true;

    if (isEmbedVideoUrl(currentVideo.url)) {
      setTimeout(() => {
        if (isMounted) handleVideoPlaying();
      }, 600);
      return () => { isMounted = false; };
    }

    const setupAndPlay = async () => {
      let playUrl = playbackUrlFor(currentVideo);

      // Safety net for any URL that slipped past the mapping (e.g. an embed
      // saved before the proxy existed): ask the resolver once.
      if (!playUrl.startsWith("/api/") && isEmbedVideoUrl(playUrl)) {
        try {
          const res = await fetch(`/api/resolve-video-stream?url=${encodeURIComponent(playUrl)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.streamUrl) playUrl = data.streamUrl;
          }
        } catch (e) {
          console.warn("Error resolving video stream:", e);
        }
      }

      if (!isMounted || !videoRef.current) return;
      const vid = videoRef.current;

      const attemptPlay = () => {
        if (!isMounted || callStateRef.current === "ENDED") return;
        const playPromise = vid.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (isMounted) handleVideoPlaying();
            })
            .catch((err) => {
              console.warn("Autoplay with sound prevented, switching to muted autoplay:", err);
              vid.muted = true;
              setAudioEnabled(false);
              vid.play().then(() => {
                if (isMounted) handleVideoPlaying();
              }).catch((playErr) => {
                console.error("Muted playback failed:", playErr);
                if (isMounted) handleVideoError();
              });
            });
        }
      };

      const isHlsStream = playUrl.includes(".m3u8") || playUrl.includes("hls-proxy");

      if (!playUrl || (playUrl.includes(".html") && !playUrl.includes("hls-proxy"))) {
        console.warn("Unresolved HTML embed URL or empty URL cannot be played directly, switching video.");
        handleVideoError();
        return;
      }

      if (isHlsStream && Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 60,
          maxBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.loadSource(playUrl);
        hls.attachMedia(vid);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isMounted) attemptPlay();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!isMounted || callStateRef.current === "ENDED") return;
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              case Hls.ErrorTypes.NETWORK_ERROR:
              default:
                hls.destroy();
                hlsRef.current = null;
                handleVideoError();
                break;
            }
          }
        });
      } else if (isHlsStream && vid.canPlayType("application/vnd.apple.mpegurl")) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        vid.src = playUrl;
        attemptPlay();
      } else {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        vid.src = playUrl;
        attemptPlay();
      }
    };

    setupAndPlay();

    return () => {
      isMounted = false;
    };
  }, [currentVideo]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, chatOpen]);

  const startCall = async (overridePersona?: Persona | null, isAnsweringIncoming = false) => {
    const targetPersona = overridePersona || persona;
    countedCallRef.current = false;
    callStateRef.current = "CONNECTING";
    setCallState("CONNECTING");
    if (!isAnsweringIncoming) {
      startRinging();
    } else {
      stopRinging();
      playPickup();
    }
    setCallDuration(0);
    hasPickedUp.current = false;
    hasAutoSwitched.current = false;
    // Set user's own camera to full screen on initial call
    setActiveFullView("local");

    // Turn camera ON immediately when user calls
    setIsCameraStarting(true);
    if (localStreamRef.current && localStreamRef.current.active) {
      setCameraEnabled(true);
      setIsCameraStarting(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraEnabled(true);
        setCameraNotice(null);
        setIsCameraStarting(false);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: any) {
        console.warn("Camera auto-access was not granted or unavailable:", err?.name || err?.message);
        setCameraEnabled(false);
        setIsCameraStarting(false);
      }
    } else {
      setIsCameraStarting(false);
    }

    startCallSession(isAnsweringIncoming, targetPersona || undefined);
  };

  const triggerUserBusy = () => {
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;

    if (pickupDelayTimeoutRef.current) clearTimeout(pickupDelayTimeoutRef.current);
    if (videoSafetyTimeoutRef.current) clearTimeout(videoSafetyTimeoutRef.current);
    if (nextVideoTimeoutRef.current) clearTimeout(nextVideoTimeoutRef.current);
    if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);

    stopRinging();
    playBusyTone();

    setBusyKind("network");
    callStateRef.current = "USER_BUSY";
    setCallState("USER_BUSY");
    setIsRemoteVideoPlaying(false);
    hasPickedUp.current = false;
  };

  /**
   * Refuse a call the regulator does not allow.
   *
   * Everything that could still make noise or keep a video running is stopped
   * first, so the client never hears ringing behind an error screen. The chat
   * is closed on the way out: the Message button on the block screen opens it
   * again, and seeing why the call did not happen matters more than the chat
   * view they were in.
   */
  const showBlockedScreen = (state: CallAccessState) => {
    if (pickupDelayTimeoutRef.current) clearTimeout(pickupDelayTimeoutRef.current);
    if (videoSafetyTimeoutRef.current) clearTimeout(videoSafetyTimeoutRef.current);
    if (nextVideoTimeoutRef.current) clearTimeout(nextVideoTimeoutRef.current);
    if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
    pickupDelayTimeoutRef.current = null;
    videoSafetyTimeoutRef.current = null;
    nextVideoTimeoutRef.current = null;
    ringingTimeoutRef.current = null;

    stopRinging();
    playBusyTone();
    setIsRemoteVideoPlaying(false);
    hasPickedUp.current = false;
    hasAutoSwitched.current = false;
    setChatOpen(false);

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
        hlsRef.current = null;
      } catch (e) {}
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      } catch (e) {}
    }

    if (state.reason === "window-exhausted") {
      setBusyKind("limit");
      callStateRef.current = "CALL_LIMIT";
      setCallState("CALL_LIMIT");
    } else {
      setBusyKind("cooldown");
      callStateRef.current = "USER_BUSY";
      setCallState("USER_BUSY");
    }
  };

  /**
   * The only way a call may start.
   *
   * Asks the server first; if the visitor is out of calls the busy / limit
   * screen is shown instead of ringing. If the endpoint cannot be reached the
   * call goes ahead — a busy API must never become a broken product.
   */
  const beginCall = async (overridePersona?: Persona | null, isAnsweringIncoming = false) => {
    if (beginCallBusyRef.current) return;
    const target = overridePersona || persona;
    const targetSlug = String(target?.slug || slug || "").trim().toLowerCase();
    if (!targetSlug) return;

    beginCallBusyRef.current = true;
    try {
      const state = await fetchCallAccess(targetSlug);
      if (state) {
        applyAccessState(state);
        if (!state.allowed) {
          showBlockedScreen(state);
          return;
        }
      }
      await startCall(overridePersona, isAnsweringIncoming);
    } finally {
      beginCallBusyRef.current = false;
    }
  };

  /** Called once per call, the moment the persona's video really starts. */
  const countThisCall = () => {
    if (countedCallRef.current) return;
    countedCallRef.current = true;
    const targetSlug = String(persona?.slug || slug || "").trim().toLowerCase();
    if (!targetSlug) return;
    void postConnectedCall(targetSlug)
      .then((state) => {
        if (state) applyAccessState(state);
      })
      .catch(() => undefined);
  };

  const startCallSession = (isAnsweringIncoming = false, targetPersonaParam?: Persona) => {
    const targetPersona = targetPersonaParam || persona;
    if (!targetPersona) return;

    setCallState("CONNECTING");

    const validVideos =
      targetPersona?.videos && targetPersona.videos.length > 0
        ? targetPersona.videos.filter((v) => v && v.url && v.url.trim().length > 0)
        : [];

    initialPersonaVideosRef.current = validVideos;
    setVideos(validVideos);

    setIsRemoteVideoPlaying(false);
    hasPickedUp.current = false;
    hasAutoSwitched.current = false;
    setActiveFullView("local");

    if (pickupDelayTimeoutRef.current) {
      clearTimeout(pickupDelayTimeoutRef.current);
      pickupDelayTimeoutRef.current = null;
    }

    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    // 30 Seconds Ringing Timeout: if phone rings > 30s without video loading (network error/delay) -> User Busy
    ringingTimeoutRef.current = setTimeout(() => {
      if (!hasPickedUp.current && callStateRef.current !== "ENDED" && callStateRef.current !== "ENDING" && callStateRef.current !== "USER_BUSY") {
        console.warn("[CALL] Ringing timed out after 30 seconds without video loading -> User Busy");
        triggerUserBusy();
      }
    }, 30000);

    if (validVideos.length > 0) {
      const pickupDelay = isAnsweringIncoming
        ? 1000
        : Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;

      console.log(`[CALL] Phone ringing... Pickup scheduled in ${(pickupDelay / 1000).toFixed(1)}s`);

      pickupDelayTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;
        pickNextVideo(validVideos, null);
      }, pickupDelay);
    } else {
      setCurrentVideo(null);
      currentVideoRef.current = null;
    }
  };

  const pickNextVideo = (availableVideos: PersonaVideo[], previousId: string | null) => {
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;

    let candidates = (availableVideos || []).filter((v) => v && v.url && v.url.trim().length > 0);
    
    if (candidates.length === 0) {
      candidates = (initialPersonaVideosRef.current || []).filter(
        (v) => v && v.url && v.url.trim().length > 0
      );
    }

    if (candidates.length === 0) {
      setCurrentVideo(null);
      currentVideoRef.current = null;
      return;
    }

    if (candidates.length > 1 && previousId) {
      const filtered = candidates.filter((v) => v.id !== previousId);
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }

    const randomVideo = candidates[Math.floor(Math.random() * candidates.length)];
    if (!randomVideo) return;
    setUseIframeFallback(false);
    currentVideoRef.current = randomVideo;
    setCurrentVideo({ ...randomVideo });

    if (videoSafetyTimeoutRef.current) clearTimeout(videoSafetyTimeoutRef.current);
    videoSafetyTimeoutRef.current = setTimeout(() => {
      if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;
      if (
        callStateRef.current === "CONNECTING" ||
        callStateRef.current === "VIDEO_LOADING" ||
        callStateRef.current === "VIDEO_BUFFERING"
      ) {
        console.warn("Video stream taking too long to start, triggering video error / fallback");
        handleVideoError();
      }
    }, 8000);
  };

  const hasPickedUp = useRef(false);

  const handleVideoPlaying = () => {
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
      return;
    }

    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    setIsRemoteVideoPlaying(true);

    if (!hasPickedUp.current) {
      hasPickedUp.current = true;
      stopRinging();
      playPickup();
      // The call connected: this is the moment it costs the client one call.
      countThisCall();
    }
    setCallState("VIDEO_PLAYING");

    if (!hasAutoSwitched.current) {
      hasAutoSwitched.current = true;
      setActiveFullView("remote");
    }
  };

  const handleVideoEnded = () => {
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING") return;
    
    // Pause video at final frame and end call without auto-switching to next clip
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch (e) {}
    }

    if (nextVideoTimeoutRef.current) {
      clearTimeout(nextVideoTimeoutRef.current);
      nextVideoTimeoutRef.current = null;
    }

    setIsRemoteVideoPlaying(true);
    callStateRef.current = "ENDED";
    setCallState("ENDED");
  };

  const handleVideoError = () => {
    if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;

    // If network error occurs while ringing before pickup, show User Busy
    if (!hasPickedUp.current) {
      console.warn("[CALL] Network error while ringing, triggering User Busy");
      triggerUserBusy();
      return;
    }

    setIsRemoteVideoPlaying(false);
    const activeVid = currentVideoRef.current || currentVideo;
    if (!activeVid) return;

    console.warn("Video failed to play, switching to next clip for active persona:", activeVid.url || "unknown");

    const remainingVideos = videos.filter(
      (v) => v.id !== activeVid.id && v.url && v.url.trim().length > 0
    );

    if (remainingVideos.length > 0) {
      setVideos(remainingVideos);
      setCallState("WAITING_FOR_NEXT_CLIP");
      if (nextVideoTimeoutRef.current) clearTimeout(nextVideoTimeoutRef.current);
      nextVideoTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING" || callStateRef.current === "USER_BUSY") return;
        pickNextVideo(remainingVideos, null);
        setCallState("VIDEO_LOADING");
      }, 1000);
      return;
    }

    // If all clips in current cycle have been tried, reset to this persona's original video list
    const personaVideos = (initialPersonaVideosRef.current || []).filter(
      (v) => v && v.url && v.url.trim().length > 0
    );

    if (personaVideos.length > 0) {
      setVideos(personaVideos);
      setCallState("WAITING_FOR_NEXT_CLIP");
      if (nextVideoTimeoutRef.current) clearTimeout(nextVideoTimeoutRef.current);
      nextVideoTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === "ENDED" || callStateRef.current === "ENDING") return;
        pickNextVideo(personaVideos, null);
        setCallState("VIDEO_LOADING");
      }, 1000);
    } else {
      setVideos([]);
      setCurrentVideo(null);
      currentVideoRef.current = null;
    }
  };

  const endCall = () => {
    callStateRef.current = "ENDED";
    setCallState("ENDED");
    setIsRemoteVideoPlaying(false);
    hasPickedUp.current = false;
    hasAutoSwitched.current = false;
    setActiveFullView("local");
    setIsCameraStarting(false);

    // 1. Force stop, rewind, and unload video element and destroy Hls instance
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
        hlsRef.current = null;
      } catch (e) {}
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      } catch (err) {
        console.warn("Video cleanup warning:", err);
      }
    }
    setCurrentVideo(null);

    // 2. Clear all video transition timers
    if (nextVideoTimeoutRef.current) {
      clearTimeout(nextVideoTimeoutRef.current);
      nextVideoTimeoutRef.current = null;
    }
    if (videoSafetyTimeoutRef.current) {
      clearTimeout(videoSafetyTimeoutRef.current);
      videoSafetyTimeoutRef.current = null;
    }
    if (pickupDelayTimeoutRef.current) {
      clearTimeout(pickupDelayTimeoutRef.current);
      pickupDelayTimeoutRef.current = null;
    }
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    // 3. Stop user camera stream
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setCameraEnabled(false);

    // 4. Stop audio cues and ringtone
    stopRinging();
    playHangup();
  };

  const handleAcceptIncomingCall = () => {
    stopRinging();
    playPickup();
    const targetPersona = incomingCallData?.persona || persona;
    setIncomingCallData(null);
    setChatOpen(false);
    // Answering is still a call with this profile: same limits apply.
    void beginCall(targetPersona, true);
  };

  const handleDeclineIncomingCall = (_trigger?: "rejected" | "timeout") => {
    stopRinging();
    playHangup();
    setIncomingCallData(null);

    // Clear any previous missed-call timers if pending
    if (missedCallTypingTimeoutRef.current) {
      clearTimeout(missedCallTypingTimeoutRef.current);
      missedCallTypingTimeoutRef.current = null;
    }
    if (missedCallMessageTimeoutRef.current) {
      clearTimeout(missedCallMessageTimeoutRef.current);
      missedCallMessageTimeoutRef.current = null;
    }

    // Delay 5 seconds before showing "... is typing" so it looks natural and human
    missedCallTypingTimeoutRef.current = setTimeout(() => {
      setIsTyping("typing");

      // Natural typing duration of 2.8 seconds before delivering the follow-up message
      missedCallMessageTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        const declineMsg = getRandomMissedOrRejectedCallMessage();
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: declineMsg,
            timestamp: new Date(),
            reactions: [],
          },
        ]);
      }, 2800);
    }, 5000);
  };

  const handleStartOrSwitchToVideo = () => {
    if (callState === "ENDED" || callState === "IDLE" || callState === "VIDEO_ERROR") {
      void beginCall();
    } else {
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }
    setChatOpen(false);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    const previewUrl = URL.createObjectURL(file);

    setPendingAttachment({
      file,
      previewUrl,
      name: file.name,
      type: isImg ? "image" : isVid ? "video" : "file",
    });

    e.target.value = "";
  };

  const sendChatMessage = async (e?: FormEvent) => {
    e?.preventDefault();
    const hasText = inputMessage.trim().length > 0;
    const hasAttachment = !!pendingAttachment;
    if ((!hasText && !hasAttachment) || !persona) return;

    // First click: opens ad URL without sending message
    if (!canSendAfterAdRef.current) {
      canSendAfterAdRef.current = true;
      openAdLink();
      return;
    }

    // Second click: sends message and resets flag for the next cycle
    canSendAfterAdRef.current = false;

    const attached = pendingAttachment;
    setPendingAttachment(null);

    const userMsgId = Date.now().toString();
    const newMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: inputMessage.trim(),
      timestamp: new Date(),
      status: "sent",
      reactions: [],
      attachmentUrl: attached?.previewUrl,
      attachmentType: attached?.type,
      attachmentName: attached?.name,
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputMessage("");
    setIsTyping(false);

    // AI Reply generator function
    const triggerAiReply = async () => {
      // 1. Mark as "seen" after 2 seconds
      window.setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, status: "seen", seenAt: new Date() } : m))
        );
      }, 2000);

      // 2. React to user message / attachment with specific delays
      if (attached) {
        // "When an attachment is been sent to the chat, the reaction should wait for 8 seconds before it reacts"
        const shockedEmojis = ["😍", "🔥", "😳", "🙈", "❤️", "🫦", "🫢"];
        const pickedEmoji = shockedEmojis[Math.floor(Math.random() * shockedEmojis.length)];
        window.setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === userMsgId) {
                const current = m.reactions || [];
                if (!current.some((r) => r.by === "assistant")) {
                  return {
                    ...m,
                    reactions: [...current, { emoji: pickedEmoji, by: "assistant" }],
                  };
                }
              }
              return m;
            })
          );
        }, 8000);
      } else {
        // "Then normal messages not all first messages should be reacted to some might be the second or next."
        const userMsgCount = messages.filter((m) => m.role === "user").length + 1;
        let shouldAssistantReact = false;

        if (userMsgCount === 1) {
          // First message: only 15% chance to react
          shouldAssistantReact = Math.random() < 0.15;
        } else if (userMsgCount === 2) {
          // Second message: 60% chance to react
          shouldAssistantReact = Math.random() < 0.6;
        } else {
          // Subsequent messages: 50% chance to react
          shouldAssistantReact = Math.random() < 0.5;
        }

        if (shouldAssistantReact) {
          const lower = newMsg.content.toLowerCase();
          let pickedEmoji = "❤️";
          if (lower.match(/love|cute|pretty|beautiful|gorgeous|hot|sexy|kiss|date|crush|marry|sweet|dress|outfit/)) {
            const flirty = ["❤️", "🔥", "😏", "💋", "😍"];
            pickedEmoji = flirty[Math.floor(Math.random() * flirty.length)];
          } else if (lower.match(/haha|lol|lmao|funny|joke|crazy|laugh|😂|🤣/)) {
            const funny = ["😂", "😜", "😏"];
            pickedEmoji = funny[Math.floor(Math.random() * funny.length)];
          } else {
            const spicy = ["😏", "🔥", "❤️", "✨", "🙈", "💋"];
            pickedEmoji = spicy[Math.floor(Math.random() * spicy.length)];
          }

          window.setTimeout(() => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === userMsgId) {
                  const current = m.reactions || [];
                  if (!current.some((r) => r.by === "assistant")) {
                    return {
                      ...m,
                      reactions: [...current, { emoji: pickedEmoji, by: "assistant" }],
                    };
                  }
                }
                return m;
              })
            );
          }, 3500);
        }
      }

      // 3. Typing indicator timing:
      const taskResult = evaluateMiniTaskAgent(newMsg.content, persona?.name);
      const isCallTask = taskResult.taskType === "CALL_USER";
      const isDateReqEarly = isMeetUpOrDateRequest(newMsg.content);
      const isManagerReqEarly = isManagerRequest(newMsg.content);
      const isSocialReqEarly = isSocialMediaOrContactRequest(newMsg.content) || isDateReqEarly || isManagerReqEarly;
      const isAdultPicReqEarly = isAdultPictureRequest(newMsg.content);
      const hasOtherMeaningEarly = hasSubstantialNonAdultMeaning(newMsg.content);
      const isAdultReqEarly = !isAdultPicReqEarly && isAdultWordMentioned(newMsg.content) && !hasOtherMeaningEarly;
      const isVideoReqEarly = isVideoRequest(newMsg.content);
      const isMediaReqEarly = !isSocialReqEarly && !isCallTask && !isAdultReqEarly && !isAdultPicReqEarly && isMediaOrImageRequest(newMsg.content);
      const aiSentPhotosEarly = messages.filter((m) => m.role === "assistant" && ((m.attachmentUrl && (m.attachmentType === "image" || !m.attachmentType)) || m.wasImage));
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentPhotos = aiSentPhotosEarly.filter(m => new Date(m.timestamp) > oneDayAgo);
      const hasReachedPhotoLimitEarly = isMediaReqEarly && recentPhotos.length >= MAX_PHOTOS_PER_CHAT;
      // If it's a call task challenge ("prove you're not a bot" / "call me"):
      // Fast and snappy (1.2s - 2.0s) so she instantly accepts the challenge!
      // Attachment: 13s
      // Normal message: 5s to 10s
      const typingDelay = isCallTask
        ? Math.floor(Math.random() * 800) + 1200
        : attached
        ? 13000 // 8s reaction + 5s wait before typing starts
        : Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000; // 5000ms to 10000ms (5-10 seconds)

      const typingTimer = window.setTimeout(() => {
        setIsTyping(((isMediaReqEarly && !hasReachedPhotoLimitEarly) || isAdultPicReqEarly) ? "sending_image" : "typing");
      }, typingDelay);

      // Typing duration (1.8s - 3s for call task, 3.5s - 5s for normal)
      const typingDuration = isCallTask
        ? Math.floor(Math.random() * 1200) + 1800
        : Math.floor(Math.random() * (5000 - 3500 + 1)) + 3500;
      const totalDeliveryDelay = typingDelay + typingDuration;

      try {
        if (attached) {
          const shockingMsg = SHOCKING_LOVE_IT_MESSAGES[Math.floor(Math.random() * SHOCKING_LOVE_IT_MESSAGES.length)];
          await new Promise((resolve) => setTimeout(resolve, totalDeliveryDelay));

          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content: shockingMsg,
              timestamp: new Date(),
              reactions: [],
            },
          ]);
        } else {
          const apiHistory = messages.map((m) => ({ role: m.role, content: m.content }));
          const isDateReq = isMeetUpOrDateRequest(newMsg.content);
          const isManagerReq = isManagerRequest(newMsg.content);
          const isSocialReq = isSocialMediaOrContactRequest(newMsg.content) || isDateReq || isManagerReq;
          const isAdultPicReq = isAdultPictureRequest(newMsg.content);
          const hasOtherMeaning = hasSubstantialNonAdultMeaning(newMsg.content);
          // Adult rejection word works ONLY if the sentence has NO other meaning apart from an adult word
          const isAdultReq = !isAdultPicReq && isAdultWordMentioned(newMsg.content) && !hasOtherMeaning;
          const isVideoReq = isVideoRequest(newMsg.content);
          const isMediaReq = !isSocialReq && !isCallTask && !isAdultReq && !isAdultPicReq && isMediaOrImageRequest(newMsg.content);
          const aiSentPhotos = messages.filter((m) => m.role === "assistant" && ((m.attachmentUrl && (m.attachmentType === "image" || !m.attachmentType)) || m.wasImage));
          const aiPhotoCount = aiSentPhotos.length;
          const sentAttachmentUrls = aiSentPhotos.map((m) => m.attachmentUrl).filter(Boolean) as string[];

          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentPhotos = aiSentPhotos.filter(m => new Date(m.timestamp) > oneDayAgo);
        const hasReachedPhotoLimit = isMediaReq && recentPhotos.length >= MAX_PHOTOS_PER_CHAT;
          // Send an image for regular media requests (under limit) OR when adult picture is requested (with rejection message)
          const profileImageAttachment = ((isMediaReq && !hasReachedPhotoLimit) || isAdultPicReq)
            ? selectProfileImageForChat(persona, sentAttachmentUrls)
            : null;

          const apiPromise = fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              personaId: persona.id,
              message: newMsg.content,
              history: apiHistory,
              sentPhotoCount: aiPhotoCount,
              sentPhotoUrls: sentAttachmentUrls,
            }),
          });

          const delayPromise = new Promise((resolve) => setTimeout(resolve, totalDeliveryDelay));

          const [res] = await Promise.all([apiPromise, delayPromise]);

          if (!res.ok) throw new Error("API Error");

          const data = await res.json();
          // The handle comes from the deployment (MANAGER_TELEGRAM), not from a
          // hardcoded string in the bundle.
          if (data.managerTelegram) setManagerTelegram(data.managerTelegram);

          let finalContent = sanitizeHumanChatOutput(data.message, persona.name, newMsg.content);
          // 1. Task: Call User
          if (isCallTask || data.action?.type === "CALL_USER") {
            if (!finalContent || !/call|screen|phone|dial|ring|pick up/i.test(finalContent)) {
              finalContent = taskResult.suggestedReply || "Oh you think I'm a bot? Say less! Calling you right now, answer me! 📞😏";
            }
          }
          // 2. Adult pictures / nudes request: Send profile image with the specific rejection message & manager link
          else if (isAdultPicReq) {
            if (!finalContent || !hasManagerLink(finalContent) || !/(only this type|contact my manager)/i.test(finalContent)) {
              finalContent = getAdultPictureManagerRejectionMessage(persona.name, newMsg.content);
            }
          }
          // 3. Manager direct inquiry
          else if (isManagerReq) {
            if (!finalContent || !hasManagerLink(finalContent)) {
              finalContent = getManagerTelegramMessage(persona.name, newMsg.content);
            }
          }
          // 4. Adult words handling (without picture request): warm, playful boundary, never cold
          else if (isAdultReq) {
            if (
              !finalContent ||
              /i cannot|i can't|unable to|as an ai|inappropriate|safety policy|guidelines/i.test(finalContent) ||
              !/(physical conversation|account being banned|banned|classy|in person)/i.test(finalContent)
            ) {
              finalContent = getAdultWordPlayfulResponse(newMsg.content, persona.name);
            }
          }
          // 5. Social media & contact request guarantee: contact manager on telegram creatively with permanent link
          else if (isDateReq || isSocialReq) {
            if (!finalContent) {
              finalContent = isDateReq
                ? getMeetUpOrDateManagerTelegramMessage(persona.name, newMsg.content)
                : getSocialMediaManagerTelegramMessage(persona.name, newMsg.content);
            } else if (!hasManagerLink(finalContent)) {
              finalContent = isDateReq
                ? `${finalContent.trim()} Reach out to my manager on Telegram to arrange our meetup: ${managerLinkText()} 😉`
                : `${finalContent.trim()} Reach out to my manager on Telegram with this link: ${managerLinkText()} 😉`;
            }
          } else if (hasReachedPhotoLimit && !/profile/i.test(finalContent)) {
            finalContent = PHOTO_LIMIT_EXCEEDED_MESSAGES[Math.floor(Math.random() * PHOTO_LIMIT_EXCEEDED_MESSAGES.length)];
          } else if (isVideoReq && !hasReachedPhotoLimit && !/photo|pic|picture|selfie|image/i.test(finalContent)) {
            finalContent = VIDEO_REQUEST_IMAGE_CAPTIONS[Math.floor(Math.random() * VIDEO_REQUEST_IMAGE_CAPTIONS.length)];
          }

          // Images sent on regular media requests or adult picture requests; never on pure text adult words, calls, or social requests
          const finalAttachmentUrl = (hasReachedPhotoLimit || (isSocialReq && !isAdultPicReq) || isCallTask || isAdultReq)
            ? undefined
            : (data.attachmentUrl || profileImageAttachment || undefined);
          const finalAttachmentType = finalAttachmentUrl
            ? "image"
            : undefined;
          const finalAttachmentName = finalAttachmentUrl
            ? `${persona.name}'s Photo`
            : undefined;

          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content: finalContent,
              attachmentUrl: finalAttachmentUrl,
              attachmentType: finalAttachmentType,
              attachmentName: finalAttachmentName,
              timestamp: new Date(),
              reactions: [],
            },
          ]);

          // Mini Task Agent: Dispatch incoming call if call task triggered!
          if (isCallTask || data.action?.type === "CALL_USER") {
            const callDelay = data.action?.delayMs || taskResult.delayBeforeCallMs || 1400;
            window.setTimeout(() => {
              startRinging();
              setIncomingCallData({
                persona,
                reason: data.action?.reason || taskResult.callReason || "prove_not_bot",
              });
            }, callDelay);
          }
        }
      } catch {
        const taskResult = evaluateMiniTaskAgent(newMsg.content, persona?.name);
        const isCallTask = taskResult.taskType === "CALL_USER";
        const isDateReq = isMeetUpOrDateRequest(newMsg.content);
        const isManagerReq = isManagerRequest(newMsg.content);
        const isSocialReq = isSocialMediaOrContactRequest(newMsg.content) || isDateReq || isManagerReq;
        const isAdultPicReq = isAdultPictureRequest(newMsg.content);
        const hasOtherMeaning = hasSubstantialNonAdultMeaning(newMsg.content);
        // Adult rejection word works ONLY if the sentence has NO other meaning apart from an adult word
        const isAdultReq = !isAdultPicReq && isAdultWordMentioned(newMsg.content) && !hasOtherMeaning;
        const isVideoReq = isVideoRequest(newMsg.content);
        const isMediaReq = !isSocialReq && !isCallTask && !isAdultReq && !isAdultPicReq && isMediaOrImageRequest(newMsg.content);
        const aiSentPhotos = messages.filter((m) => m.role === "assistant" && ((m.attachmentUrl && (m.attachmentType === "image" || !m.attachmentType)) || m.wasImage));
        const aiPhotoCount = aiSentPhotos.length;
        const sentAttachmentUrls = aiSentPhotos.map((m) => m.attachmentUrl).filter(Boolean) as string[];
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentPhotos = aiSentPhotos.filter(m => new Date(m.timestamp) > oneDayAgo);
        const hasReachedPhotoLimit = isMediaReq && recentPhotos.length >= MAX_PHOTOS_PER_CHAT;

        // Send image for regular media requests (under limit) OR when adult picture is requested (with rejection message)
        const profileImageAttachment = ((isMediaReq && !hasReachedPhotoLimit) || isAdultPicReq)
          ? selectProfileImageForChat(persona, sentAttachmentUrls)
          : null;

        let fallbackCaption = "Mmm, you caught me daydreaming about you 😏 What were you saying?";
        if (isCallTask) {
          fallbackCaption = taskResult.suggestedReply || "Oh you think I'm a bot? Say less! Calling you right now, answer me! 📞😏";
        } else if (isAdultPicReq) {
          fallbackCaption = getAdultPictureManagerRejectionMessage(persona.name, newMsg.content);
        } else if (isManagerReq) {
          fallbackCaption = getManagerTelegramMessage(persona.name, newMsg.content);
        } else if (isAdultReq) {
          fallbackCaption = getAdultWordPlayfulResponse(newMsg.content, persona.name);
        } else if (isDateReq) {
          fallbackCaption = getMeetUpOrDateManagerTelegramMessage(persona.name, newMsg.content);
        } else if (isSocialReq) {
          fallbackCaption = getSocialMediaManagerTelegramMessage(persona.name, newMsg.content);
        } else if (hasReachedPhotoLimit) {
          fallbackCaption = PHOTO_LIMIT_EXCEEDED_MESSAGES[Math.floor(Math.random() * PHOTO_LIMIT_EXCEEDED_MESSAGES.length)];
        } else if (isVideoReq) {
          fallbackCaption = VIDEO_REQUEST_IMAGE_CAPTIONS[Math.floor(Math.random() * VIDEO_REQUEST_IMAGE_CAPTIONS.length)];
        } else if (isMediaReq) {
          fallbackCaption = PHOTO_REPLY_CAPTIONS[Math.floor(Math.random() * PHOTO_REPLY_CAPTIONS.length)];
        }

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: attached
              ? "OMG wait... 😳 WOW I love this!! You're killing me right now 🔥"
              : fallbackCaption,
            attachmentUrl: (hasReachedPhotoLimit || (isSocialReq && !isAdultPicReq) || isCallTask || isAdultReq) ? undefined : (profileImageAttachment || undefined),
            attachmentType: (hasReachedPhotoLimit || (isSocialReq && !isAdultPicReq) || isCallTask || isAdultReq || !profileImageAttachment) ? undefined : "image",
            attachmentName: (hasReachedPhotoLimit || (isSocialReq && !isAdultPicReq) || isCallTask || isAdultReq || !profileImageAttachment) ? undefined : `${persona.name}'s Photo`,
            timestamp: new Date(),
            reactions: [],
          },
        ]);

        if (isCallTask) {
          window.setTimeout(() => {
            startRinging();
            setIncomingCallData({
              persona,
              reason: taskResult.callReason || "prove_not_bot",
            });
          }, 1400);
        }
      } finally {
        window.clearTimeout(typingTimer);
        setIsTyping(false);
      }
    };

    // Always execute response immediately when user sends a chat message
    if (!onlineStatus.isOnline) {
      handleToggleOnlineStatus();
    }
    triggerAiReply();
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const isLocalFull = activeFullView === "local";
  const isRemoteFull = activeFullView === "remote";

  /** Where "Home" / "Back" should go (private mode has no public home). */
  const ownProfilePath = `/dreamgirl/${persona?.slug || slug || ""}`;
  const goHome = () => navigate(isPrivate ? ownProfilePath : "/");
  const goExplore = () => navigate(isPrivate ? ownProfilePath : "/dreamgirls");
  const goBrowse = () => navigate(isPrivate ? ownProfilePath : "/personas");

  return (
    <div className="h-screen w-full bg-[#07080e] overflow-hidden relative select-none">
      {/* Main Call View Area (Fullscreen alone when !chatOpen, hidden when in Chat mode) */}
      <div className={`w-full h-full relative flex-col bg-[#05060b] ${!chatOpen ? "flex" : "hidden"}`}>
        {(callState === "USER_BUSY" && busyKind !== "network") || callState === "CALL_LIMIT" ? (
          <CallBlockedScreen
            kind={callState === "CALL_LIMIT" ? "limit" : "cooldown"}
            personaName={persona?.name || "User"}
            personaImage={persona?.profileImage}
            retryInMs={retryInMs()}
            maxCalls={callAccess?.limits.maxCalls ?? 5}
            windowHours={callAccess?.limits.windowHours ?? 5}
            cooldownHours={callAccess?.limits.cooldownHours ?? 2}
            onMessage={() => setChatOpen(true)}
            onHome={() => {
              endCall();
              goHome();
            }}
            onViewProfile={() => {
              endCall();
              navigate(`/persona/${persona?.slug || slug}`);
            }}
            onCallNow={() => void beginCall()}
          />
        ) : callState === "USER_BUSY" ? (
          <div className="w-full h-full bg-[#05060b] flex flex-col items-center justify-center p-6 relative">
            {/* Top Navigation Bar: Home & View Profile buttons */}
            <div className="absolute top-6 inset-x-6 md:top-8 md:inset-x-8 flex items-center justify-between z-10">
              <button
                onClick={() => {
                  endCall();
                  goHome();
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors border border-white/10 text-sm font-medium cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </button>

              <button
                onClick={() => {
                  endCall();
                  navigate(`/persona/${persona?.slug || slug}`);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-pink-300 hover:text-white rounded-full transition-all border border-pink-500/40 text-sm font-semibold shadow-lg shadow-pink-500/10 cursor-pointer"
              >
                <User className="w-4 h-4" />
                <span>View Profile</span>
              </button>
            </div>

            <div className="relative mb-8">
              <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-amber-500/40 bg-neutral-900 shadow-2xl shadow-amber-500/20">
                {persona?.profileImage ? (
                  <img src={persona.profileImage} alt={persona.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                    <User className="w-16 h-16 text-neutral-600" />
                  </div>
                )}
              </div>
              <div className="absolute bottom-2 right-2 bg-amber-500/20 rounded-full p-2 border-4 border-[#050505] shadow-lg">
                <PhoneOff className="w-5 h-5 text-amber-400" />
              </div>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight text-white mb-2 flex items-center gap-2">
              <span>User Busy</span>
              <span className="text-amber-400 text-2xl">🚫</span>
            </h2>
            <p className="text-neutral-400 mb-10 text-center max-w-md">
              {persona?.name || "User"} is currently busy or unavailable. Please try calling again later.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <button
                onClick={() => setChatOpen(true)}
                className="flex-1 py-3.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-2xl font-semibold transition-colors border border-white/10 flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-pink-400" />
                <span>Message</span>
              </button>
              <button
                onClick={() => void beginCall()}
                className="flex-1 py-3.5 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-white rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-500/20 cursor-pointer"
              >
                <Video className="w-4 h-4" />
                <span>Call Again</span>
              </button>
              <button
                onClick={() => {
                  endCall();
                  navigate(`/persona/${persona?.slug || slug}`);
                }}
                className="flex-1 py-3.5 bg-white/10 hover:bg-white/15 text-white rounded-2xl font-semibold transition-colors border border-white/15 flex items-center justify-center gap-2 cursor-pointer"
              >
                <User className="w-4 h-4 text-purple-300" />
                <span>View Profile</span>
              </button>
            </div>
          </div>
        ) : callState === "IDLE" ? (
          <div className="w-full h-full bg-[#05060b] flex flex-col items-center justify-center p-6 relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute top-1/3 -left-32 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/3 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* TOP BAR */}
            <div className="absolute top-6 inset-x-6 md:top-8 md:inset-x-8 flex items-center justify-between z-10">
              <button
                onClick={() => navigate(`/persona/${persona?.slug || slug}`)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors border border-white/10 text-sm font-medium cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back to Profile</span>
              </button>

              <button
                onClick={() => setProfileModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white rounded-full transition-colors border border-white/10 text-xs font-medium cursor-pointer"
              >
                <Info className="w-3.5 h-3.5 text-pink-400" />
                <span>Profile Info</span>
              </button>
            </div>

            {/* CENTER PERSONA CARD */}
            <div className="relative mb-6">
              <div className="p-1 rounded-full bg-gradient-to-tr from-[#e1147a] via-[#ec4899] to-[#9333ea] shadow-2xl shadow-pink-500/25">
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden border-4 border-[#05060b] bg-neutral-900">
                  {persona?.profileImage ? (
                    <img src={persona.profileImage} alt={persona.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900 text-white text-3xl font-bold">
                      {persona?.name?.charAt(0) || "P"}
                    </div>
                  )}
                </div>
              </div>
              {onlineStatus.isOnline ? (
                <span className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-emerald-400 border-3 border-[#05060b] shadow-[0_0_12px_rgba(52,211,153,0.9)] flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping opacity-75" />
                </span>
              ) : (
                <span className="absolute bottom-2 right-2 w-5 h-5 rounded-full bg-neutral-500 border-2 border-[#05060b]" />
              )}
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1.5 text-center">
              {persona?.name || "Persona"}
            </h2>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mb-4">
              <span>@{persona?.slug || slug}</span>
              <span>•</span>
              <span className={onlineStatus.isOnline ? "text-emerald-400 font-semibold" : "text-neutral-400"}>
                {onlineStatus.isOnline ? "Online 🟢" : onlineStatus.statusText}
              </span>
            </div>

            {persona?.shortBio && (
              <p className="text-neutral-300 text-xs sm:text-sm max-w-md text-center line-clamp-2 mb-8 px-4 font-normal">
                "{persona.shortBio}"
              </p>
            )}

            {/* ACTION CTA BUTTONS */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
              <button
                type="button"
                onClick={() => void beginCall()}
                className="w-full sm:flex-1 py-3.5 px-6 rounded-full bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] hover:opacity-95 text-white font-semibold text-sm shadow-xl shadow-pink-500/25 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
              >
                <Video className="w-4 h-4" />
                <span>Start Video Call</span>
              </button>

              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="w-full sm:w-auto py-3.5 px-6 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white font-medium text-sm border border-white/15 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-pink-400" />
                <span>Chat ({messages.length})</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* TOP OVERLAY BAR */}
            <div className="absolute top-0 inset-x-0 z-40 p-4 md:p-6 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
              <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    endCall();
                    if (window.history.length > 1) {
                      navigate(-1);
                    } else {
                      goExplore();
                    }
                  }}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
                  title="Go Back"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    endCall();
                    goExplore();
                  }}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer"
                  title="Home / Explore Dreamgirls"
                >
                  <Home className="w-4 h-4" />
                </button>

                <div
                  onClick={() => {
                    if (persona?.slug) {
                      endCall();
                      navigate(`/dreamgirl/${persona.slug}`);
                    }
                  }}
                  className="flex flex-col cursor-pointer group/title"
                  title={`View ${persona?.name || "Dreamgirl"}'s full profile`}
                >
                  <span className="font-semibold text-white text-sm sm:text-base tracking-tight drop-shadow-md group-hover/title:text-pink-300 transition-colors">
                    {persona?.name || "Calling..."}
                  </span>
                  <span className="text-[11px] sm:text-xs text-white/75 font-medium flex items-center gap-1.5 drop-shadow">
                    {callState === "VIDEO_PLAYING" ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        {formatTimer(callDuration)}
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span>
                        Connecting...
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto">
                {/* Fit / Fill toggle button */}
                <button
                  onClick={() => setVideoFitMode(videoFitMode === "cover" ? "contain" : "cover")}
                  className="px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-xs font-medium text-white/90 hover:bg-white/10 transition-colors flex items-center gap-1.5"
                  title={videoFitMode === "cover" ? "Switch to Fit mode (uncropped)" : "Switch to Fill mode (full screen)"}
                >
                  <Maximize2 className="w-3.5 h-3.5 text-pink-400" />
                  <span className="hidden sm:inline">{videoFitMode === "cover" ? "Fit Video" : "Fill Screen"}</span>
                </button>

                {/* Quick Screen Swap button in header */}
                <button
                  onClick={toggleScreenSwap}
                  className="px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-xs font-medium text-white/90 hover:bg-white/10 transition-colors flex items-center gap-1.5"
                  title="Tap to swap screens"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden sm:inline">Swap view</span>
                </button>

                <button
                  onClick={() => setAudioEnabled(!audioEnabled)}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                  title={audioEnabled ? "Mute Speaker" : "Unmute Speaker"}
                >
                  {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-red-400" />}
                </button>
              </div>
            </div>

            {/* VIDEO LAYERS */}
            <div className="flex-1 relative w-full h-full overflow-hidden bg-[#05060b] flex items-center justify-center">
              {/* LAYER 1: LOCAL USER CAMERA */}
              <div
                onClick={!isLocalFull ? toggleScreenSwap : undefined}
                className={`transition-all duration-500 ease-out overflow-hidden ${
                  isLocalFull
                    ? "absolute inset-0 w-full h-full z-10 bg-neutral-950 flex items-center justify-center"
                    : "absolute top-14 right-3 sm:top-16 sm:right-6 md:top-20 md:right-8 w-24 h-36 sm:w-36 sm:h-52 md:w-48 md:h-64 rounded-2xl border-2 border-white/30 hover:border-white/60 shadow-2xl shadow-black/90 z-30 cursor-pointer hover:scale-[1.03] active:scale-95 group bg-neutral-900"
                }`}
              >
                {cameraEnabled ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                ) : isCameraStarting ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-neutral-400 text-xs gap-3 p-4 bg-neutral-950">
                    <div className="w-12 h-12 rounded-full bg-pink-500/15 border border-pink-500/30 flex items-center justify-center text-pink-400 shadow-lg shadow-pink-500/10">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                    <span className="font-semibold text-white text-sm">Starting your camera...</span>
                    <span className="text-[11px] text-neutral-400 max-w-xs text-center">
                      Please allow camera permission if prompted by your browser
                    </span>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-neutral-500 text-xs gap-2 p-3 bg-neutral-950">
                    <VideoOff className="w-6 h-6 text-neutral-600" />
                    <span className="text-center font-medium">Camera Off</span>
                    {isLocalFull && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCamera();
                        }}
                        className="mt-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors border border-white/10 cursor-pointer"
                      >
                        Turn On Camera
                      </button>
                    )}
                  </div>
                )}

                {muted && (
                  <div className="absolute bottom-2 left-2 bg-red-500/90 backdrop-blur-sm rounded-full p-1.5 shadow-md">
                    <MicOff className="w-3 h-3 text-white" />
                  </div>
                )}

                {!isLocalFull && (
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="p-2 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/20">
                      <ArrowLeftRight className="w-4 h-4 text-purple-300" />
                    </div>
                  </div>
                )}
              </div>

              {/* LAYER 2: REMOTE PERSONA VIDEO */}
              <div
                onClick={!isRemoteFull ? toggleScreenSwap : undefined}
                className={`transition-all duration-500 ease-out overflow-hidden bg-neutral-950 ${
                  isRemoteFull
                    ? "absolute inset-0 w-full h-full z-10 flex items-center justify-center"
                    : "absolute top-14 right-3 sm:top-16 sm:right-6 md:top-20 md:right-8 w-24 h-36 sm:w-36 sm:h-52 md:w-48 md:h-64 rounded-2xl border-2 border-white/30 hover:border-white/60 shadow-2xl shadow-black/90 z-30 cursor-pointer hover:scale-[1.03] active:scale-95 group"
                }`}
              >
                {currentVideo && (
                  ((isEmbedVideoUrl(currentVideo.url) &&
                    !(currentVideo.streamUrl || "").startsWith("/api/")) ||
                    useIframeFallback) ? (
                    <div className="w-full h-full relative overflow-hidden flex items-center justify-center bg-[#05060b]">
                      <iframe
                        key={currentVideo.id}
                        src={getAutoplayEmbedUrl(currentVideo.url)}
                        title={currentVideo.title || "Live Stream"}
                        className="w-[115%] h-[125%] -translate-x-[7.5%] -translate-y-[12.5%] border-0 relative z-10 bg-black object-cover pointer-events-auto"
                        allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write; web-share"
                        allowFullScreen
                        referrerPolicy="no-referrer-when-downgrade"
                        onLoad={() => {
                          handleVideoPlaying();
                        }}
                      />
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      key={currentVideo.id}
                      preload="auto"
                      className={`w-full h-full ${
                        isRemoteFull
                          ? videoFitMode === "contain"
                            ? "object-contain bg-black"
                            : "object-cover object-center"
                          : "object-cover object-center"
                      } transition-opacity duration-700 ${
                        isRemoteVideoPlaying ? "opacity-100" : "opacity-0"
                      }`}
                      autoPlay
                      playsInline
                      muted={!audioEnabled}
                      onPlay={handleVideoPlaying}
                      onPlaying={handleVideoPlaying}
                      onEnded={handleVideoEnded}
                      onError={() => {
                        if (isEmbedVideoUrl(currentVideo?.url)) {
                          setUseIframeFallback(true);
                        } else {
                          handleVideoError();
                        }
                      }}
                      onWaiting={() => setCallState("VIDEO_BUFFERING")}
                      onContextMenu={(e) => e.preventDefault()}
                    />
                  )
                )}

                {(!isRemoteVideoPlaying || callState === "CONNECTING") && (
                  <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black flex flex-col items-center justify-center p-4 text-center pointer-events-none z-20">
                    <div className="relative mb-3.5">
                      <div
                        className={`${
                          isRemoteFull ? "w-28 h-28 md:w-36 md:h-36" : "w-14 h-14 sm:w-16 sm:h-16"
                        } rounded-full overflow-hidden border-2 border-purple-500/40 shadow-xl bg-neutral-800 relative z-10`}
                      >
                        {persona?.profileImage ? (
                          <img
                            src={persona.profileImage}
                            alt={persona.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white font-bold text-xl">
                            {persona?.name?.charAt(0) || "P"}
                          </div>
                        )}
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-purple-500 animate-ping opacity-35 pointer-events-none"></div>
                      <div className="absolute -inset-2 rounded-full border border-pink-500/25 animate-pulse pointer-events-none"></div>
                    </div>

                    <span
                      className={`font-semibold text-white tracking-tight ${
                        isRemoteFull ? "text-xl mb-1.5" : "text-xs mb-0.5"
                      }`}
                    >
                      {persona?.name || "Persona"}
                    </span>

                    <span
                      className={`text-purple-300/90 font-medium flex items-center gap-1.5 ${
                        isRemoteFull ? "text-sm mt-1" : "text-[10px] mt-0.5"
                      }`}
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                      {callState === "CONNECTING" ? "Calling..." : "Buffering video stream..."}
                    </span>

                    {isRemoteFull && callState === "CONNECTING" && (
                      <p className="text-[11px] text-neutral-400 mt-2 max-w-xs">
                        Connecting live camera feed...
                      </p>
                    )}
                  </div>
                )}

                {callState === "VIDEO_BUFFERING" && isRemoteVideoPlaying && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-20">
                    <Loader2 className="w-7 h-7 text-white animate-spin" />
                  </div>
                )}

                {!isRemoteFull && (
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-30">
                    <div className="p-2 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/20">
                      <ArrowLeftRight className="w-4 h-4 text-purple-300" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CAMERA NOTIFICATION TOAST */}
            {cameraNotice && (
              <div className="absolute bottom-24 inset-x-4 max-w-md mx-auto z-50 bg-neutral-900/95 border border-purple-500/30 text-white rounded-2xl p-3 shadow-2xl backdrop-blur-md flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-auto">
                <div className="p-1.5 bg-amber-500/20 text-amber-400 rounded-full shrink-0">
                  <VideoOff className="w-4 h-4" />
                </div>
                <div className="flex-1 text-xs">
                  <p className="font-semibold text-neutral-200">Camera Notice</p>
                  <p className="text-neutral-400 mt-0.5 leading-relaxed">{cameraNotice}</p>
                </div>
                <button
                  onClick={() => setCameraNotice(null)}
                  className="p-1 text-neutral-400 hover:text-white rounded-lg transition-colors shrink-0"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* BOTTOM CONTROLS BAR */}
            <div className="absolute bottom-6 inset-x-0 z-40 flex items-center justify-center px-4 pointer-events-none">
              <div className="pointer-events-auto bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-full px-4 py-2.5 flex items-center gap-3 sm:gap-4 shadow-2xl shadow-black/80">
                <button
                  onClick={() => setMuted(!muted)}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    muted ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                  title={muted ? "Unmute Mic" : "Mute Mic"}
                >
                  {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>

                <button
                  onClick={toggleCamera}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                    !cameraEnabled
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                  title={cameraEnabled ? "Turn Camera Off" : "Turn Camera On"}
                >
                  {!cameraEnabled ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>

                <button
                  onClick={toggleScreenSwap}
                  className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all"
                  title="Swap main and small screens"
                >
                  <ArrowLeftRight className="w-5 h-5 text-purple-300" />
                </button>

                <button
                  onClick={() => setChatOpen(!chatOpen)}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all relative ${
                    chatOpen ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                  title="Open Chat"
                >
                  <MessageSquare className="w-5 h-5" />
                  {messages.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-purple-400"></span>
                  )}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white hidden md:flex items-center justify-center transition-all"
                  title="Toggle Fullscreen"
                >
                  <Maximize2 className="w-5 h-5" />
                </button>

                <button
                  onClick={endCall}
                  className="w-13 h-11 px-4 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-all shadow-lg shadow-red-600/40 ml-1"
                  title="End Call"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* CALL ENDED OVERLAY */}
            {callState === "ENDED" && (
              <div className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-md flex flex-col items-center justify-center p-6">
                {/* Top Navigation Bar: Home & View Profile buttons */}
                <div className="absolute top-6 inset-x-6 md:top-8 md:inset-x-8 flex items-center justify-between z-10">
                  <button
                    onClick={() => {
                      endCall();
                      goHome();
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors border border-white/10 text-sm font-medium cursor-pointer"
                  >
                    <Home className="w-4 h-4" />
                    <span>Home</span>
                  </button>

                  <button
                    onClick={() => {
                      endCall();
                      navigate(`/persona/${persona?.slug || slug}`);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-pink-300 hover:text-white rounded-full transition-all border border-pink-500/40 text-sm font-semibold shadow-lg shadow-pink-500/10 cursor-pointer"
                  >
                    <User className="w-4 h-4" />
                    <span>View Profile</span>
                  </button>
                </div>

                <div className="relative mb-8">
                  <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-[#050505] bg-neutral-900 shadow-2xl">
                    {persona?.profileImage ? (
                      <img src={persona.profileImage} alt={persona.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                        <User className="w-16 h-16 text-neutral-600" />
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-2 right-2 bg-neutral-800 rounded-full p-2 border-4 border-[#050505] shadow-lg">
                    <PhoneOff className="w-5 h-5 text-neutral-400" />
                  </div>
                </div>

                <h2 className="text-3xl font-semibold tracking-tight text-white mb-2">Call Ended</h2>
                <p className="text-neutral-400 mb-3 text-center">
                  Your conversation with {persona?.name || "the persona"} has ended.
                </p>
                <p className="mb-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-neutral-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="h-3.5 w-3.5" />
                    {callAccess?.limits.cooldownHours ?? 2}h before you can call {persona?.name || "her"} again
                  </span>
                  {callAccess && (
                    <span className="text-neutral-600">·</span>
                  )}
                  {callAccess && (
                    <span>
                      {callAccess.remaining > 0
                        ? `${callAccess.remaining} of ${callAccess.limits.maxCalls} calls left in the next ${callAccess.limits.windowHours}h`
                        : "No call slots left right now — chat stays open"}
                    </span>
                  )}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                  <button
                    onClick={() => setChatOpen(true)}
                    className="flex-1 py-3.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-2xl font-semibold transition-colors border border-white/10 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 text-pink-400" />
                    <span>Message</span>
                  </button>
                  <button
                    onClick={() => void beginCall()}
                    className="flex-1 py-3.5 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-white rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-500/20 cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                    <span>Call Again</span>
                  </button>
                  <button
                    onClick={() => {
                      endCall();
                      navigate(`/persona/${persona?.slug || slug}`);
                    }}
                    className="flex-1 py-3.5 bg-white/10 hover:bg-white/15 text-white rounded-2xl font-semibold transition-colors border border-white/15 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <User className="w-4 h-4 text-purple-300" />
                    <span>View Profile</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* CHAT PAGE (STANDALONE FULLSCREEN - NO SPLIT SCREEN ON DESKTOP OR MOBILE) */}
      <div
        className={`
        w-full h-full bg-[#080911] flex flex-col z-50 overflow-hidden
        ${chatOpen ? "flex" : "hidden"}
      `}
      >
        <div className="h-16 border-b border-white/10 flex items-center justify-between px-3 sm:px-6 shrink-0 bg-[#0c0e18] backdrop-blur-md gap-3">
          {/* Left Navigation: Back & Home buttons + Persona Avatar & Profile info */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Back Button */}
            <button
              type="button"
              onClick={() => {
                if (
                  callState !== "ENDED" &&
                  callState !== "IDLE" &&
                  callState !== "USER_BUSY" &&
                  callState !== "CALL_LIMIT"
                ) {
                  setChatOpen(false);
                } else if (window.history.length > 1) {
                  navigate(-1);
                } else {
                  goBrowse();
                }
              }}
              title={
                callState !== "ENDED" &&
                callState !== "IDLE" &&
                callState !== "USER_BUSY" &&
                callState !== "CALL_LIMIT"
                  ? "Back to Call"
                  : "Go Back"
              }
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 flex items-center justify-center transition-all shrink-0 cursor-pointer group"
            >
              <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            </button>

            {/* Home Button */}
            <button
              type="button"
              onClick={goBrowse}
              title="Home / Explore Personas"
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/15 text-neutral-300 hover:text-white border border-white/10 flex items-center justify-center transition-all shrink-0 cursor-pointer group"
            >
              <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </button>

            {/* Persona Avatar and Name - Navigates directly to full profile page */}
            <div
              onClick={() => persona?.slug && navigate(`/persona/${persona.slug}`)}
              className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-white/5 transition-all cursor-pointer min-w-0 group/prof"
              title={`View ${persona?.name || "Persona"}'s full profile`}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-pink-500/40 bg-neutral-800 shadow-sm group-hover/prof:border-pink-400 group-hover/prof:scale-105 transition-all">
                  {persona?.profileImage ? (
                    <img
                      src={persona.profileImage}
                      alt={persona.name}
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                      {persona?.name?.charAt(0) || "P"}
                    </div>
                  )}
                </div>
                {onlineStatus.isOnline ? (
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-neutral-950 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                ) : (
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-neutral-500 border-2 border-neutral-950" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-semibold text-white text-sm sm:text-base group-hover/prof:text-pink-300 transition-colors truncate">
                    {persona?.name || "Persona"}
                  </span>
                  {persona?.age && (
                    <span className="text-xs text-neutral-400 font-normal shrink-0">({persona.age})</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {onlineStatus.isOnline ? (
                    <span className="text-emerald-400 font-medium">Online</span>
                  ) : (
                    <span className="text-neutral-400 truncate">{onlineStatus.statusText}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleOnlineStatus();
                    }}
                    title="Switch online/offline mode"
                    className="text-neutral-500 hover:text-pink-400 transition-colors ml-0.5 p-0.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* If call is active: Show pulsating Return to Call button */}
            {callState !== "ENDED" &&
            callState !== "IDLE" &&
            callState !== "USER_BUSY" &&
            callState !== "CALL_LIMIT" ? (
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="px-3 sm:px-4 py-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:opacity-95 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-emerald-950/40 active:scale-95 transition-all cursor-pointer"
                title="Return to full-screen video call"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
                <span className="whitespace-nowrap font-medium">Back to Call ({formatTimer(callDuration)})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartOrSwitchToVideo}
                className="px-3 sm:px-4 py-2 rounded-full bg-gradient-to-r from-[#e1147a] to-[#9333ea] hover:opacity-95 text-white border border-pink-500/40 transition-all text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-pink-950/50 active:scale-95 cursor-pointer"
                title="Start Video Call"
              >
                <Video className="w-4 h-4 text-white shrink-0" />
                <span className="font-medium whitespace-nowrap">Start Call</span>
              </button>
            )}

            <button
              onClick={() => setChatOpen(false)}
              className="text-neutral-400 hover:text-white p-2 rounded-xl hover:bg-white/10 text-xl leading-none transition-colors cursor-pointer flex items-center justify-center"
              title="Close chat page"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 relative" ref={chatScrollRef}>
          {activeReactionMenuMsgId && (
            <div
              className="fixed inset-0 z-20"
              onClick={() => setActiveReactionMenuMsgId(null)}
            />
          )}

          {/* Photos sent counter indicator */}
          {(() => {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const aiSentCount = messages.filter((m) => m.role === "assistant" && ((m.attachmentUrl && (m.attachmentType === "image" || !m.attachmentType)) || m.wasImage) && new Date(m.timestamp) > oneDayAgo).length;
            if (aiSentCount === 0) return null;
            return (
              <div className="p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-between text-xs text-pink-200 shadow-sm animate-in fade-in">
                <span className="flex items-center gap-1.5 font-medium text-[11px]">
                  <ImageIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                  <span>Photos in chat: <strong className="text-pink-300 font-bold">{aiSentCount}/{MAX_PHOTOS_PER_CHAT}</strong></span>
                </span>
                {aiSentCount >= MAX_PHOTOS_PER_CHAT ? (
                  <button
                    type="button"
                    onClick={() => persona?.slug && navigate(`/persona/${persona.slug}?tab=photos`)}
                    className="text-[11px] font-semibold text-pink-300 hover:text-white bg-pink-500/20 hover:bg-pink-500/30 px-2 py-0.5 rounded-md border border-pink-400/30 flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <span>View Profile Photos</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="text-[10px] text-pink-300/80">Max {MAX_PHOTOS_PER_CHAT} photos per 24 hours</span>
                )}
              </div>
            );
          })()}

          {/* Offline notice alert banner */}
          {!onlineStatus.isOnline && (
            <div className="p-3 rounded-xl bg-neutral-900/90 border border-white/10 text-xs text-neutral-300 flex items-start gap-2.5 shadow-md">
              <span className="w-2 h-2 rounded-full bg-neutral-400 shrink-0 mt-1" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-white">
                  {persona?.name || "She"} is offline ({onlineStatus.lastSeenText})
                </p>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  Messages are delivered and she will reply when she switches to online.
                </p>
                <button
                  type="button"
                  onClick={handleToggleOnlineStatus}
                  className="mt-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-pink-300 font-semibold text-[11px] border border-white/10 inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3 text-pink-400" />
                  <span>Bring {persona?.name || "her"} online now</span>
                </button>
              </div>
            </div>
          )}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs text-center px-4">
              <MessageSquare className="w-8 h-8 mb-3 opacity-40 text-purple-400" />
              Say hi to {persona?.name || "them"}! Type a message below.
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`group flex gap-2.5 max-w-[88%] relative ${
                m.role === "user" ? "self-end items-end flex-row-reverse" : "self-start items-start flex-row"
              }`}
            >
              {/* Profile image for persona assistant texts - clickable to view full profile page */}
              {m.role === "assistant" && (
                <button
                  type="button"
                  onClick={() => persona?.slug && navigate(`/persona/${persona.slug}`)}
                  title={`View ${persona?.name || "Persona"}'s full profile`}
                  className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-white/10 hover:border-pink-400 bg-neutral-800 mt-1 shadow-sm transition-all hover:scale-110 active:scale-95 cursor-pointer"
                >
                  {persona?.profileImage ? (
                    <img src={persona.profileImage} alt={persona.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-purple-900/60 text-[10px] font-bold text-purple-200">
                      {persona?.name?.[0] || "A"}
                    </div>
                  )}
                </button>
              )}

              <div className={`flex flex-col relative ${m.role === "user" ? "items-end" : "items-start"}`}>
                {/* Floating Emoji Picker */}
                {activeReactionMenuMsgId === m.id && (
                  <div
                    className={`absolute -top-9 z-30 bg-neutral-900/95 backdrop-blur-md border border-white/20 rounded-full px-2 py-0.5 flex items-center gap-1 shadow-xl animate-in fade-in zoom-in-95 duration-150 ${
                      m.role === "user" ? "right-0" : "left-0"
                    }`}
                  >
                    {EMOJI_LIST.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleUserReaction(m.id, emoji)}
                        className="hover:scale-125 transition-transform text-sm p-1 rounded-full hover:bg-white/10"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  {/* Reaction trigger for user message (left of bubble) */}
                  {m.role === "user" && (
                    <button
                      type="button"
                      onClick={() => setActiveReactionMenuMsgId(activeReactionMenuMsgId === m.id ? null : m.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-white rounded-full hover:bg-white/10"
                      title="React to message"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <div
                    className={`p-3 rounded-2xl text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-purple-600 text-white rounded-tr-none shadow-md shadow-purple-600/20"
                        : "bg-white/10 text-neutral-100 rounded-tl-none border border-white/5 shadow-sm"
                    }`}
                  >
                    {m.attachmentUrl && (
                      <div className="mb-2 overflow-hidden rounded-xl border border-white/15 bg-black/40">
                        {m.attachmentType === "video" ? (
                          <video
                            src={m.attachmentUrl}
                            autoPlay
                            playsInline
                            muted
                            loop
                            draggable={false}
                            onContextMenu={(e) => e.preventDefault()}
                            className="max-h-52 max-w-full rounded-xl object-cover"
                          />
                        ) : (
                          <div
                            className="relative group/img cursor-pointer overflow-hidden rounded-xl"
                            onClick={() => setChatImageLightbox(m.attachmentUrl!)}
                          >
                            <img
                              src={m.attachmentUrl}
                              alt={m.attachmentName || "Attachment"}
                              draggable={false}
                              onContextMenu={(e) => e.preventDefault()}
                              className="max-h-56 max-w-full object-cover rounded-xl transition-transform duration-200 group-hover/img:scale-[1.02]"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity rounded-xl flex items-center justify-center pointer-events-none">
                              <span className="px-2.5 py-1 rounded-full bg-black/80 text-white text-[10px] font-semibold backdrop-blur-xs border border-white/20">
                                Tap to view full size
                              </span>
                            </div>
                          </div>
                        )}
                        {m.attachmentName && (
                          <div className="px-2.5 py-1 text-[10px] text-neutral-300 bg-black/60 border-t border-white/5 flex items-center justify-between">
                            <span className="truncate font-medium">{m.attachmentName}</span>
                            <span className="text-pink-300 text-[9px] shrink-0 ml-2 font-semibold">Protected</span>
                          </div>
                        )}
                      </div>
                    )}
                    {m.content && (
                      <div>
                        {(() => {
                          // Link whichever t.me/… the reply actually contains, so an
                          // older message still points somewhere useful.
                          const segments = splitManagerLinks(m.content);
                          if (!segments.some((segment) => segment.link)) return m.content;
                          return (
                            <span>
                              {segments.map((segment, idx) =>
                                segment.link ? (
                                  <a
                                    key={idx}
                                    href={segment.link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline font-bold text-sky-300 hover:text-sky-200 transition-colors"
                                  >
                                    {segment.text}
                                  </a>
                                ) : (
                                  <span key={idx}>{segment.text}</span>
                                )
                              )}
                            </span>
                          );
                        })()}
                      </div>
                    )}

                    {/* Quick-action button if message contains manager telegram link */}
                    {m.role === "assistant" && !!findManagerLink(m.content) && (
                      <a
                        href={findManagerLink(m.content)?.url || managerLinkUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-200 text-[11px] font-medium transition-all shadow-sm group/btn cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Send className="w-3.5 h-3.5 text-sky-400 group-hover/btn:scale-110 transition-transform shrink-0" />
                          <span className="truncate font-semibold">
                            {`Contact Manager on Telegram (@${
                              findManagerLink(m.content)?.handle || managerHandle()
                            })`}
                          </span>
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-sky-400/80 group-hover/btn:translate-x-0.5 transition-transform shrink-0" />
                      </a>
                    )}

                    {/* Quick-action button if the persona directs the user to her profile */}
                    {m.role === "assistant" && (/profile/i.test(m.content) || /gallery/i.test(m.content)) && (
                      <button
                        type="button"
                        onClick={() => persona?.slug && navigate(`/persona/${persona.slug}?tab=photos`)}
                        className="mt-2.5 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/30 text-pink-200 text-[11px] font-medium transition-all shadow-sm group/btn cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Sparkles className="w-3.5 h-3.5 text-pink-400 group-hover/btn:scale-110 transition-transform shrink-0" />
                          <span className="truncate font-semibold">View {persona?.name ? `${persona.name}'s` : "Her"} Profile & Photos</span>
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-pink-400/80 group-hover/btn:translate-x-0.5 transition-transform shrink-0" />
                      </button>
                    )}
                  </div>

                  {/* Reaction trigger for assistant message (right of bubble) */}
                  {m.role === "assistant" && (
                    <button
                      type="button"
                      onClick={() => setActiveReactionMenuMsgId(activeReactionMenuMsgId === m.id ? null : m.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-white rounded-full hover:bg-white/10"
                      title="React to message"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Grouped Reactions */}
                {m.reactions && m.reactions.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {groupReactions(m.reactions).map(([emoji, data]) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleUserReaction(m.id, emoji)}
                        title={data.hasAssistant ? `${persona?.name || "She"} reacted with ${emoji}` : undefined}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-all ${
                          data.hasUser
                            ? "bg-purple-900/60 border-purple-500 text-purple-200 shadow-sm shadow-purple-500/20"
                            : "bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10"
                        }`}
                      >
                        <span>{emoji}</span>
                        {data.count > 1 && <span className="text-[10px] font-medium">{data.count}</span>}
                        {data.hasAssistant && !data.hasUser && (
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400" title="Assistant reacted"></span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Timestamp & Status */}
                <div className="flex items-center gap-1 text-[10px] text-neutral-500 mt-1 px-1">
                  <span>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {m.role === "user" && (
                    <span className="flex items-center gap-0.5 ml-1">
                      {m.status === "seen" ? (
                        <span className="flex items-center gap-0.5 text-purple-400 font-medium">
                          <CheckCheck className="w-3.5 h-3.5 text-purple-400" />
                          <span>Seen</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-neutral-500">
                          <Check className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Sent</span>
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="self-start flex items-center gap-2.5 max-w-[88%]">
              {/* Profile image on typing indicator - clickable to view full profile */}
              <button
                type="button"
                onClick={() => persona?.slug && navigate(`/persona/${persona.slug}`)}
                title={`View ${persona?.name || "Persona"}'s full profile`}
                className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-purple-400/40 bg-neutral-800 ring-2 ring-purple-500/25 shadow-sm shadow-purple-500/20 hover:scale-110 transition-transform cursor-pointer"
              >
                {persona?.profileImage ? (
                  <img src={persona.profileImage} alt={persona.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-purple-900/60 text-[10px] font-bold text-purple-200">
                    {persona?.name?.[0] || "A"}
                  </div>
                )}
              </button>
              <div className="bg-white/10 rounded-2xl rounded-tl-none px-3.5 py-2.5 border border-white/10 flex items-center gap-2 shadow-sm">
                <span className="text-[11px] text-purple-300 font-medium">
                  {isTyping === "sending_image" ? `Sending image...` : `${persona?.name || "She"} is typing`}
                </span>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"></div>
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
                    style={{ animationDelay: "0.15s" }}
                  ></div>
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
                    style={{ animationDelay: "0.3s" }}
                  ></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pending Attachment Preview */}
        {pendingAttachment && (
          <div className="px-3.5 py-2 bg-neutral-900/95 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 overflow-hidden">
              {pendingAttachment.type === "image" ? (
                <img
                  src={pendingAttachment.previewUrl}
                  alt="Preview"
                  className="w-10 h-10 object-cover rounded-lg border border-purple-500/40 shadow-xs shrink-0"
                />
              ) : (
                <div className="w-10 h-10 bg-purple-950/60 rounded-lg flex items-center justify-center border border-purple-500/30 shrink-0">
                  <Paperclip className="w-4 h-4 text-purple-400" />
                </div>
              )}
              <div className="min-w-0 flex flex-col">
                <span className="text-white text-xs font-medium truncate max-w-[200px]">
                  {pendingAttachment.name}
                </span>
                <span className="text-[10px] text-purple-400">Photo attached (preview only)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="p-1 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
              title="Remove attachment"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={sendChatMessage} className="p-3 border-t border-white/5 bg-black/40 flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*,video/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-neutral-400 hover:text-purple-300 hover:bg-white/5 rounded-full transition-colors shrink-0"
            title="Attach photo or media"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={pendingAttachment ? "Add a caption..." : "Type a message..."}
            className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() && !pendingAttachment}
            className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* View Profile Modal */}
      <PersonaChatProfileModal
        persona={persona}
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />

      {/* Protected Lightbox for uploaded chat images */}
      <AnimatePresence>
        {chatImageLightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setChatImageLightbox(null)}
            className="fixed inset-0 z-60 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 select-none"
          >
            <button
              onClick={() => setChatImageLightbox(null)}
              className="absolute top-5 right-5 p-2.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-70 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="absolute top-5 left-5 text-xs font-semibold text-pink-300 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full border border-pink-500/30">
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
              <span>Protected Media • Saving & Screenshots Restricted</span>
            </div>
            <img
              src={chatImageLightbox}
              alt="Enlarged chat attachment"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/20"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mini Task Agent: Incoming Call Modal when persona calls user to prove not a bot or upon request */}
      {incomingCallData && (
        <IncomingCallModal
          persona={incomingCallData.persona}
          reason={incomingCallData.reason}
          onAccept={handleAcceptIncomingCall}
          onDecline={handleDeclineIncomingCall}
        />
      )}
    </div>
  );
}
