import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  createProfile,
  deleteProfile,
  formatDate,
  getProfile,
  getSite,
  listProfiles,
  updateProfile,
  type ProfileDetail,
  type ProfileSummary,
  type ProfileVideo,
} from "../../lib/admin/client";
import { ProfileLinkActions } from "./ProfileLinkActions";
import { VideoThumb } from "./VideoThumb";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Notice,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from "./ui";

const TEXT_FIELDS: Array<{ key: string; label: string; area?: boolean; hint?: string }> = [
  { key: "description", label: "Card description", area: true },
  { key: "personality", label: "Personality", area: true },
  { key: "background", label: "Background", area: true },
  { key: "interests", label: "Interests", area: true },
  { key: "speakingStyle", label: "Speaking style", area: true },
  { key: "shortBio", label: "Short bio", area: true },
  { key: "longBio", label: "Long bio", area: true },
  { key: "occupation", label: "Occupation" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "languages", label: "Languages" },
  { key: "hobbies", label: "Hobbies" },
  { key: "likes", label: "Likes" },
  { key: "dislikes", label: "Dislikes" },
];

const EXTRA_FIELDS: Array<{ key: string; label: string; area?: boolean }> = [
  { key: "bodyType", label: "Body type" },
  { key: "height", label: "Height" },
  { key: "eyeColor", label: "Eye colour" },
  { key: "hairColor", label: "Hair colour" },
  { key: "communicationTone", label: "Communication tone" },
  { key: "emojiFrequency", label: "Emoji frequency" },
  { key: "turnOns", label: "Turn-ons", area: true },
  { key: "turnOffs", label: "Turn-offs", area: true },
  { key: "fantasies", label: "Fantasies", area: true },
  { key: "intimacyStyle", label: "Intimacy style", area: true },
  { key: "preferredVibe", label: "Preferred vibe", area: true },
  { key: "kinksAndFetishes", label: "Kinks & fetishes", area: true },
  { key: "eroticInterests", label: "Erotic interests", area: true },
];

interface EditorState {
  id: string | null;
  slug: string;
  fields: Record<string, any>;
  images: string[];
  videos: Array<{ url: string; title: string }>;
}

function blankEditor(): EditorState {
  return {
    id: null,
    slug: "",
    fields: {
      name: "",
      description: "",
      personality: "",
      background: "",
      interests: "",
      speakingStyle: "",
      flirtLevel: 2,
      active: true,
    },
    images: [""],
    videos: [],
  };
}

function editorFromProfile(profile: ProfileDetail): EditorState {
  return {
    id: String(profile.id),
    slug: String(profile.slug || ""),
    fields: { ...profile },
    images: profile.images.length > 0 ? [...profile.images] : [""],
    videos: (profile.videos || []).map((video: ProfileVideo) => ({
      url: video.url,
      title: video.title || "",
    })),
  };
}

export default function ProfilesPanel() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Private mode decides whether "Open" needs a temporary share link. */
  const [isPrivate, setIsPrivate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, site] = await Promise.all([listProfiles(), getSite()]);
      setProfiles(data.profiles);
      setIsPrivate(site.private);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter(
      (profile) =>
        profile.name.toLowerCase().includes(needle) ||
        profile.slug.toLowerCase().includes(needle)
    );
  }, [profiles, query]);

  const openEditor = async (id: string) => {
    setError("");
    setNotice("");
    try {
      const { profile } = await getProfile(id);
      setEditor(editorFromProfile(profile));
      setShowExtra(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const images = editor.images.map((url) => url.trim()).filter(Boolean);
      const videos = editor.videos
        .map((video) => ({ url: video.url.trim(), title: video.title.trim() }))
        .filter((video) => video.url);
      const fields = { ...editor.fields, slug: editor.slug.trim() };

      if (editor.id) {
        await updateProfile(editor.id, { fields, images, videos });
        setNotice("Profile saved.");
        await load();
        const { profile } = await getProfile(editor.id);
        setEditor(editorFromProfile(profile));
      } else {
        const created = await createProfile({ fields, slug: editor.slug.trim(), images, videos });
        setNotice(`Profile created: /${created.slug}`);
        await load();
        const { profile } = await getProfile(created.id);
        setEditor(editorFromProfile(profile));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (profile: ProfileSummary) => {
    if (
      !window.confirm(
        `Delete "${profile.name}" (/${profile.slug})? Its videos and images are removed with it. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(profile.id);
    setError("");
    try {
      await deleteProfile(profile.id);
      setProfiles((current) => current.filter((row) => row.id !== profile.id));
      setNotice(`Deleted /${profile.slug}.`);
      if (editor?.id === profile.id) setEditor(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  // -------------------------------------------------------------------------
  // Editor view
  // -------------------------------------------------------------------------
  if (editor) {
    const set = (key: string, value: unknown) =>
      setEditor((current) =>
        current ? { ...current, fields: { ...current.fields, [key]: value } } : current
      );

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {editor.id ? `Editing ${editor.fields.name || "profile"}` : "New profile"}
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              {editor.id
                ? `/${editor.slug}`
                : "Nothing is written until you press Save profile."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditor(null)}>
              <X className="w-3.5 h-3.5" /> Close
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              <Save className="w-3.5 h-3.5" /> Save profile
            </Button>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && <Notice kind="success">{notice}</Notice>}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <SectionTitle title="Basics" subtitle="What the card and the chat prompt use." />
            <div className="space-y-3">
              <Field label="Name">
                <TextInput
                  value={editor.fields.name || ""}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Ava"
                />
              </Field>
              <Field
                label="Slug"
                hint="The public URL: /dreamgirl/<slug>. Leave blank to generate from the name."
              >
                <TextInput
                  value={editor.slug}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, slug: event.target.value } : current
                    )
                  }
                  placeholder="ava"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Age">
                  <TextInput
                    type="number"
                    min={18}
                    max={99}
                    value={editor.fields.age ?? ""}
                    onChange={(event) => set("age", event.target.value)}
                  />
                </Field>
                <Field label="Flirt level">
                  <Select
                    value={Number(editor.fields.flirtLevel ?? 2)}
                    onChange={(event) => set("flirtLevel", Number(event.target.value))}
                  >
                    <option value={0}>0 — reserved</option>
                    <option value={1}>1 — subtle</option>
                    <option value={2}>2 — playful</option>
                    <option value={3}>3 — flirty</option>
                    <option value={4}>4 — very flirty</option>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <TextInput
                    value={editor.fields.city || ""}
                    onChange={(event) => set("city", event.target.value)}
                  />
                </Field>
                <Field label="Country">
                  <TextInput
                    value={editor.fields.country || ""}
                    onChange={(event) => set("country", event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <input
                  id="active"
                  type="checkbox"
                  checked={editor.fields.active !== false}
                  onChange={(event) => set("active", event.target.checked)}
                  className="w-4 h-4 accent-pink-500"
                />
                <label htmlFor="active" className="text-xs text-neutral-300">
                  Active (visible on the public site)
                </label>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle
              title="Images"
              subtitle="First = profile picture, second = cover, the rest = gallery (max 7)."
            />
            <div className="space-y-2">
              {editor.images.map((url, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="w-12 h-12 rounded-md overflow-hidden bg-black/40 border border-white/10 shrink-0">
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.opacity = "0.15";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-600">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <TextInput
                    value={url}
                    placeholder="https://…/photo.jpg"
                    onChange={(event) =>
                      setEditor((current) => {
                        if (!current) return current;
                        const images = [...current.images];
                        images[index] = event.target.value;
                        return { ...current, images };
                      })
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() =>
                        setEditor((current) => {
                          if (!current) return current;
                          const images = [...current.images];
                          [images[index - 1], images[index]] = [images[index], images[index - 1]];
                          return { ...current, images };
                        })
                      }
                      className="text-neutral-400 hover:text-white disabled:opacity-20"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() =>
                        setEditor((current) => {
                          if (!current) return current;
                          const images = current.images.filter((_, i) => i !== index);
                          return { ...current, images: images.length ? images : [""] };
                        })
                      }
                      className="text-neutral-400 hover:text-red-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-3"
              disabled={editor.images.length >= 7}
              onClick={() =>
                setEditor((current) =>
                  current ? { ...current, images: [...current.images, ""] } : current
                )
              }
            >
              <Plus className="w-3.5 h-3.5" /> Add image slot
            </Button>
            <p className="text-[11px] text-neutral-500 mt-2">
              Only JPEG URLs that actually answer with image/jpeg are saved — the
              bot uses the same rule, so a broken link can never reach the site.
            </p>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <SectionTitle title="Profile copy" subtitle="Shown on the profile page." />
            <div className="space-y-3">
              {TEXT_FIELDS.map((field) => (
                <Field key={field.key} label={field.label}>
                  {field.area ? (
                    <TextArea
                      rows={3}
                      value={editor.fields[field.key] || ""}
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                  ) : (
                    <TextInput
                      value={editor.fields[field.key] || ""}
                      onChange={(event) => set(field.key, event.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </Card>

          <div className="space-y-5">
            <Card>
              <SectionTitle
                title="Videos"
                subtitle="Each row previews its own frame, so you can see which clip you are removing."
                right={<Badge tone="neutral">{editor.videos.length}</Badge>}
              />
              <div className="space-y-2">
                {editor.videos.length === 0 && (
                  <p className="text-xs text-neutral-500">No videos yet.</p>
                )}
                {editor.videos.map((video, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2"
                  >
                    <VideoThumb url={video.url} index={index} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <TextInput
                        value={video.url}
                        placeholder="https://…/video.mp4"
                        aria-label={`Video ${index + 1} link`}
                        onChange={(event) =>
                          setEditor((current) => {
                            if (!current) return current;
                            const videos = [...current.videos];
                            videos[index] = { ...videos[index], url: event.target.value };
                            return { ...current, videos };
                          })
                        }
                      />
                      <TextInput
                        value={video.title}
                        placeholder="Title (optional)"
                        aria-label={`Video ${index + 1} title`}
                        onChange={(event) =>
                          setEditor((current) => {
                            if (!current) return current;
                            const videos = [...current.videos];
                            videos[index] = { ...videos[index], title: event.target.value };
                            return { ...current, videos };
                          })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      title={`Remove video ${index + 1}`}
                      aria-label={`Remove video ${index + 1}`}
                      onClick={() =>
                        setEditor((current) =>
                          current
                            ? { ...current, videos: current.videos.filter((_, i) => i !== index) }
                            : current
                        )
                      }
                      className="mt-1 shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() =>
                  setEditor((current) =>
                    current
                      ? { ...current, videos: [...current.videos, { url: "", title: "" }] }
                      : current
                  )
                }
              >
                <Plus className="w-3.5 h-3.5" /> Add video
              </Button>
              <p className="text-[11px] text-neutral-500 mt-2">
                Embed links are resolved to a playable stream when you save. A link
                with no playable stream is skipped and reported. “No preview” means the
                row could not be read yet — a dead link, or an embed with no direct
                stream — not that the video will be dropped.
              </p>
            </Card>

            <Card>
              <SectionTitle
                title="Advanced"
                subtitle="Prompt and intimate fields."
                right={
                  <Button variant="ghost" onClick={() => setShowExtra((value) => !value)}>
                    {showExtra ? "Hide" : "Show"}
                  </Button>
                }
              />
              {showExtra && (
                <div className="space-y-3">
                  {EXTRA_FIELDS.map((field) => (
                    <Field key={field.key} label={field.label}>
                      {field.area ? (
                        <TextArea
                          rows={2}
                          value={editor.fields[field.key] || ""}
                          onChange={(event) => set(field.key, event.target.value)}
                        />
                      ) : (
                        <TextInput
                          value={editor.fields[field.key] || ""}
                          onChange={(event) => set(field.key, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                  <Field
                    label="System prompt"
                    hint="Never sent to the browser on the public site; only the chat route reads it."
                  >
                    <TextArea
                      rows={5}
                      value={editor.fields.systemPrompt || ""}
                      onChange={(event) => set("systemPrompt", event.target.value)}
                    />
                  </Field>
                </div>
              )}
            </Card>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditor(null)}>
            Close
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            <Save className="w-3.5 h-3.5" /> Save profile
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // List view
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-neutral-500" />
          <TextInput
            className="pl-9"
            placeholder="Search by name or slug"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
        <Button onClick={() => setEditor(blankEditor())}>
          <Plus className="w-3.5 h-3.5" /> New profile
        </Button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {isPrivate && (
        <Notice kind="info">
          Private mode is ON. Profiles still open at their own URL — only the
          home page, the browse grid and <code>/sitemap.xml</code> are hidden, so
          nobody can browse from one profile to another.
        </Notice>
      )}

      {loading ? (
        <Card>
          <Spinner label="Loading profiles…" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-300">
            {profiles.length === 0 ? "No profiles yet." : "No profile matches that search."}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Create one here, or import it from a page with the Import tab.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/10 shrink-0">
                {profile.profileImage ? (
                  <img
                    src={profile.profileImage}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.opacity = "0.15";
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600">
                    <ImageIcon className="w-4 h-4" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate">
                    {profile.name}
                  </span>
                  <span className="text-[11px] text-neutral-500">/{profile.slug}</span>
                  {!profile.active && <Badge tone="amber">inactive</Badge>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-neutral-500 mt-1">
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> {profile.images}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Video className="w-3 h-3" /> {profile.videos}
                  </span>
                  <span>updated {formatDate(profile.updatedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <ProfileLinkActions slug={profile.slug} />
                <button
                  type="button"
                  onClick={() => void openEditor(profile.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-300 hover:bg-white/5"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(profile)}
                  disabled={deleting === profile.id}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
