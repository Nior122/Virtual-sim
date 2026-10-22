// ---------------------------------------------------------------------------
// Typed client for the /admin backend.
// Every call is same-origin so the HttpOnly session cookie travels with it.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(
      (data && data.error) || `Request failed (${response.status})`,
      response.status,
      data?.details
    );
  }
  return data as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export interface SessionState {
  configured: boolean;
  authenticated: boolean;
  expiresAt: number | null;
  hours: number;
}

export const getSession = () => request<SessionState>("session");

export const login = (password: string) =>
  post<{ ok: boolean; expiresAt: number }>("session", { password });

export const logout = () => request<{ ok: boolean }>("session", { method: "DELETE" });

// ---------------------------------------------------------------------------
// Site state
// ---------------------------------------------------------------------------
export interface LinkView {
  token: string;
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number;
  remaining: string;
  uses: number;
}

export interface SiteState {
  private: boolean;
  updatedAt: number;
  adUrl: string | null;
  links: LinkView[];
  base: string;
  maxLinkSeconds: number;
}

export interface Overview {
  site: SiteState;
  profiles: { total: number | null; active: number | null };
  databaseError: string | null;
  configured: {
    password: boolean;
    kv: boolean;
    database: boolean;
    telegram: boolean;
    ownerChat: boolean;
  };
  ai: string[];
}

export const getOverview = () => request<Overview>("overview");
export const getSite = () => request<SiteState>("site");
export const setSite = (body: { private?: boolean; adUrl?: string | null }) =>
  post<SiteState>("site", body);
export const createLink = (slug: string, seconds: number) =>
  post<{ link: LinkView }>("links", { slug, seconds });
export const revokeLink = (selector: string) =>
  request<{ removed: number }>("links", {
    method: "DELETE",
    body: JSON.stringify({ selector }),
  });

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export interface ProfileSummary {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  images: number;
  videos: number;
  profileImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileVideo {
  id?: string;
  url: string;
  title: string;
  active?: boolean;
}

export interface ProfileDetail {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  images: string[];
  videos: ProfileVideo[];
  profileImage: string | null;
  coverImage: string | null;
  gallery: string | null;
  [key: string]: unknown;
}

export const listProfiles = () =>
  request<{ profiles: ProfileSummary[] }>("profiles");

export const getProfile = (id: string) =>
  request<{ profile: ProfileDetail }>(`profiles/${encodeURIComponent(id)}`);

export interface ProfilePayload {
  fields: Record<string, unknown>;
  slug?: string;
  images: string[];
  videos: Array<{ url: string; title: string }>;
}

export const createProfile = (payload: ProfilePayload) =>
  post<{ id: string; slug: string; name: string; images: number }>(
    "profiles",
    payload
  );

export const updateProfile = (id: string, payload: ProfilePayload) =>
  request<{ profile: ProfileDetail }>(`profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const deleteProfile = (id: string) =>
  request<{ ok: boolean }>(`profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export interface PreparedEntry {
  id: number;
  raw: string;
  imageSource: string;
  videoSource: string;
  slug: string;
  name: string;
  draft: Record<string, any>;
  images: string[];
  videos: string[];
  skippedVideos: number;
  usedFallbackText: boolean;
  subrequests?: number;
}

export const prepareImport = (raw: string) =>
  post<{ ok: boolean; error?: string; prepared?: PreparedEntry }>("import", {
    action: "prepare",
    raw,
  });

export const commitImport = (prepared: PreparedEntry) =>
  post<{
    result: {
      ok: boolean;
      name?: string;
      slug?: string;
      link?: string;
      images?: number;
      videos?: number;
      skippedVideos?: number;
      usedFallbackText?: boolean;
      error?: string;
    };
  }>("import", { action: "commit", prepared });

// ---------------------------------------------------------------------------
// Chat + tools
// ---------------------------------------------------------------------------
export const testChat = (slug: string, message: string) =>
  post<{ reply: string; provider: string; name: string }>("chat", { slug, message });

export interface Diagnostics {
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  title: string | null;
  imgTags: number;
  sourceTags: number;
  challenge: boolean;
  primary: string[];
  secondary: string[];
  nonJpegUrls: string[];
  probes: Array<{ url: string; ok: boolean }>;
  error?: string;
  pageError?: string;
  archive?: {
    service: string;
    user: string;
    postCount: number;
    imageUrls: number;
    videoUrls: number;
    error?: string;
  };
}

export const diagnose = (url: string) =>
  post<{ diagnostics: Diagnostics }>("tools", { action: "diag", url });

export interface VideoCheck {
  url: string;
  ok: boolean;
  status: number;
  contentType: string;
  error?: string;
}

export const checkVideos = (urls: string[]) =>
  post<{ checks: VideoCheck[] }>("tools", { action: "check-videos", urls });

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function formatDate(value: number | string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h left` : `${days}d left`;
}

export const DURATIONS: Array<{ label: string; seconds: number }> = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 6 * 3600 },
  { label: "12 hours", seconds: 12 * 3600 },
  { label: "24 hours", seconds: 24 * 3600 },
  { label: "3 days", seconds: 3 * 86400 },
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
];
