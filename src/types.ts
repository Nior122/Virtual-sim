export interface Persona {
  id: string;
  name: string;
  slug: string;
  description: string;
  profileImage: string | null;
  coverImage: string | null;
  gallery: string | null;

  isAdult: boolean;
  age: number | null;
  city: string | null;
  country: string | null;
  occupation: string | null;
  languages?: string | null;
  
  shortBio: string | null;
  longBio: string | null;

  // Physical Attributes
  bodyType?: string | null;
  bustSize?: string | null;
  height?: string | null;
  eyeColor?: string | null;
  hairColor?: string | null;
  tattoosAndPiercings?: string | null;

  // Suggestive Bio Fields
  turnOns?: string | null;
  turnOffs?: string | null;
  fantasies?: string | null;
  intimacyStyle?: string | null;
  preferredVibe?: string | null;

  // Specialized Erotic Interests
  kinksAndFetishes?: string | null;
  favoriteLingerie?: string | null;
  eroticInterests?: string | null;

  personality: string;
  background: string;
  interests: string;
  hobbies: string | null;
  likes: string | null;
  dislikes: string | null;
  
  speakingStyle: string;
  communicationTone: string | null;
  flirtLevel: number;
  emojiFrequency: string | null;

  systemPrompt?: string; // Hidden on client for security
  active: boolean;
  createdAt: string;
  updatedAt: string;
  videos?: PersonaVideo[];
}

export interface PersonaVideo {
  id: string;
  personaId?: string;
  url: string;
  streamUrl?: string | null;
  thumbnail?: string | null;
  title: string;
  active?: boolean;
  duration?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatReaction {
  emoji: string;
  by: "user" | "assistant";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  status?: "sent" | "seen";
  seenAt?: Date;
  reactions?: ChatReaction[];
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "file";
  attachmentName?: string;
}

export type CallState = 
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "VIDEO_LOADING"
  | "VIDEO_PLAYING"
  | "VIDEO_BUFFERING"
  | "VIDEO_ERROR"
  | "WAITING_FOR_NEXT_CLIP"
  | "USER_BUSY"
  /** The client used every call in the rolling window: chat only. */
  | "CALL_LIMIT"
  | "ENDING"
  | "ENDED";

export const CALL_CONFIG = {
  minimumVideoDuration: 60,
  maximumVideoDuration: 180,
  videoTransitionDelayMin: 1000,
  videoTransitionDelayMax: 3000,
};
