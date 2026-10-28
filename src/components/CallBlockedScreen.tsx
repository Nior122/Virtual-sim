import { Ban, Home, MessageSquare, PhoneOff, Timer, User, Video } from "lucide-react";
import { formatWait } from "../lib/calls/limits";

/**
 * The two screens a client hits when the call regulator says no.
 *
 *   kind="cooldown" → that one profile was already called in the last 2 hours.
 *                     "User Busy", and the only action is Message.
 *   kind="limit"    → all five calls are spent. Nothing can be called until a
 *                     slot frees; chat stays open.
 *
 * Kept out of CallSession so the copy and the button set can be rendered and
 * checked on their own — the rule "only a Message button" is a product
 * decision and deserves a test, not a grep.
 */
export interface CallBlockedScreenProps {
  kind: "cooldown" | "limit";
  personaName: string;
  personaImage?: string | null;
  /** Milliseconds until calling becomes possible again (0 = right now). */
  retryInMs: number;
  maxCalls: number;
  windowHours: number;
  cooldownHours: number;
  onMessage: () => void;
  onHome: () => void;
  onViewProfile: () => void;
  /** Re-attempt once the countdown has run out. */
  onCallNow: () => void;
}

export function CallBlockedScreen({
  kind,
  personaName,
  personaImage,
  retryInMs,
  maxCalls,
  windowHours,
  cooldownHours,
  onMessage,
  onHome,
  onViewProfile,
  onCallNow,
}: CallBlockedScreenProps) {
  const name = personaName || "User";
  const canRetry = retryInMs <= 0;
  const isLimit = kind === "limit";

  return (
    <div
      className="w-full h-full bg-[#05060b] flex flex-col items-center justify-center p-6 relative"
      data-call-block={kind}
    >
      {/* Navigation stays available: being out of calls is not a dead end. */}
      <div className="absolute top-6 inset-x-6 md:top-8 md:inset-x-8 flex items-center justify-between z-10">
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors border border-white/10 text-sm font-medium cursor-pointer"
        >
          <Home className="w-4 h-4" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={onViewProfile}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 hover:from-pink-500/30 hover:to-purple-500/30 text-pink-300 hover:text-white rounded-full transition-all border border-pink-500/40 text-sm font-semibold shadow-lg shadow-pink-500/10 cursor-pointer"
        >
          <User className="w-4 h-4" />
          <span>View Profile</span>
        </button>
      </div>

      <div className="relative mb-8">
        <div
          className={`w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 bg-neutral-900 shadow-2xl ${
            isLimit
              ? "border-rose-500/40 shadow-rose-500/20"
              : "border-amber-500/40 shadow-amber-500/20"
          }`}
        >
          {personaImage ? (
            <img src={personaImage} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
              <User className="w-16 h-16 text-neutral-600" />
            </div>
          )}
        </div>
        <div
          className={`absolute bottom-2 right-2 rounded-full p-2 border-4 border-[#050505] shadow-lg ${
            isLimit ? "bg-rose-500/20" : "bg-amber-500/20"
          }`}
        >
          {isLimit ? (
            <Ban className="w-5 h-5 text-rose-400" />
          ) : (
            <PhoneOff className="w-5 h-5 text-amber-400" />
          )}
        </div>
      </div>

      <h2 className="text-3xl font-semibold tracking-tight text-white mb-2 text-center flex items-center gap-2">
        <span>{isLimit ? "Call limit reached" : "User Busy"}</span>
        <span className={isLimit ? "text-rose-400 text-2xl" : "text-amber-400 text-2xl"}>🚫</span>
      </h2>

      <p className="text-neutral-400 mb-4 text-center max-w-md">
        {isLimit
          ? `You have used all ${maxCalls} calls for now. Calling is paused for the next ${windowHours} hours from your first call — you can still chat with ${name}.`
          : `${name} is busy right now. You can call again once the wait is over, or keep chatting in the meantime.`}
      </p>

      <p
        className={`mb-10 flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
          isLimit
            ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
            : "border-amber-500/25 bg-amber-500/10 text-amber-200"
        }`}
      >
        <Timer className="h-4 w-4 shrink-0" />
        <span>
          {canRetry
            ? isLimit
              ? "A call slot is free again"
              : "You can call again now"
            : isLimit
              ? `Calls unlock in ${formatWait(retryInMs)}`
              : `You can call again in ${formatWait(retryInMs)}`}
        </span>
      </p>

      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
        <button
          type="button"
          onClick={onMessage}
          className="flex-1 py-3.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-2xl font-semibold transition-colors border border-white/10 flex items-center justify-center gap-2 cursor-pointer"
        >
          <MessageSquare className="w-4 h-4 text-pink-400" />
          <span>Message</span>
        </button>

        {canRetry && (
          <button
            type="button"
            onClick={onCallNow}
            className="flex-1 py-3.5 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-white rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-500/20 cursor-pointer"
          >
            <Video className="w-4 h-4" />
            <span>{isLimit ? "Try Again" : "Call Now"}</span>
          </button>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-neutral-600">
        {isLimit
          ? `One call per profile every ${cooldownHours} hours, ${maxCalls} calls every ${windowHours} hours.`
          : `One call per profile every ${cooldownHours} hours.`}
      </p>
    </div>
  );
}

export default CallBlockedScreen;
