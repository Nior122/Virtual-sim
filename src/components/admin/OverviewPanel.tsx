import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Link2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  DURATIONS,
  createLink,
  formatDate,
  getOverview,
  listProfiles,
  revokeLink,
  setSite,
  timeLeft,
  type Overview,
  type ProfileSummary,
} from "../../lib/admin/client";
import {
  Badge,
  Button,
  Card,
  CopyButton,
  ErrorNote,
  Field,
  Notice,
  SectionTitle,
  Select,
  Spinner,
  TextInput,
  Toggle,
} from "./ui";

export default function OverviewPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slug, setSlug] = useState("");
  const [seconds, setSeconds] = useState(6 * 3600);
  const [adUrl, setAdUrl] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [data, list] = await Promise.all([getOverview(), listProfiles()]);
      setOverview(data);
      setAdUrl(data.site.adUrl || "");
      setProfiles(list.profiles);
      // Preselect the first profile so creating a link is a two-click job.
      setSlug((current) => current || list.profiles[0]?.slug || "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const site = overview?.site;

  const togglePrivate = async (next: boolean) => {
    setBusy("private");
    setError("");
    setNotice("");
    try {
      const state = await setSite({ private: next });
      setOverview((current) => (current ? { ...current, site: state } : current));
      setNotice(
        next
          ? "Private mode is ON. Only visitors with a share link can open a profile."
          : "Private mode is OFF. The whole site is public again."
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveAdUrl = async (value: string | null) => {
    setBusy("ad");
    setError("");
    setNotice("");
    try {
      const state = await setSite({ adUrl: value });
      setOverview((current) => (current ? { ...current, site: state } : current));
      setAdUrl(state.adUrl || "");
      setNotice(
        state.adUrl
          ? "Expired links now redirect to that ad URL."
          : "Ad URL cleared. Expired links show a neutral page."
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addLink = async () => {
    if (!slug) return;
    setBusy("link");
    setError("");
    setNotice("");
    try {
      const { link } = await createLink(slug, seconds);
      setOverview((current) =>
        current
          ? { ...current, site: { ...current.site, links: [link, ...current.site.links] } }
          : current
      );
      setNotice(`Link created for /${slug} — valid for ${link.remaining.replace(" left", "")}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeLink = async (selector: string) => {
    setBusy(`revoke:${selector}`);
    setError("");
    try {
      const { removed } = await revokeLink(selector);
      setOverview((current) =>
        current
          ? {
              ...current,
              site: {
                ...current.site,
                links: current.site.links.filter(
                  (link) => link.token !== selector && link.slug !== selector
                ),
              },
            }
          : current
      );
      setNotice(`${removed} link${removed === 1 ? "" : "s"} revoked.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const activeLinks = useMemo(() => site?.links ?? [], [site]);

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading the site state…" />
      </Card>
    );
  }

  if (!overview || !site) {
    return (
      <Card>
        <ErrorNote>{error || "Could not load the dashboard."}</ErrorNote>
        <div className="mt-3">
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {/* Private mode */}
      <Card
        className={
          site.private
            ? "border-pink-500/40 bg-pink-500/[0.06]"
            : undefined
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {site.private ? (
                <ShieldCheck className="w-4 h-4 text-pink-400" />
              ) : (
                <ExternalLink className="w-4 h-4 text-neutral-400" />
              )}
              <h2 className="text-sm font-semibold text-white">
                Private mode: {site.private ? "ON" : "OFF"}
              </h2>
              <Badge tone={site.private ? "pink" : "green"}>
                {site.private ? "link-only" : "public"}
              </Badge>
            </div>
            <p className="text-xs text-neutral-400 mt-2 max-w-xl leading-relaxed">
              {site.private
                ? "The home page, the browse grid and every profile except the one in a share link answer 404. The linked profile keeps its photos, videos and chat."
                : "Everyone can see the home page, the browse grid and every profile. Turning this on hides everything except a visitor's shared profile."}
            </p>
            {site.private && (
              <p className="text-[11px] text-neutral-500 mt-2">
                KV propagates in about a minute — an edge location that has not
                caught up yet may still serve the public site briefly.
              </p>
            )}
          </div>
          <Toggle
            checked={site.private}
            disabled={busy !== null}
            onChange={(next) => void togglePrivate(next)}
            label="Private mode"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
          <span>Last changed: {formatDate(site.updatedAt)}</span>
          <span>·</span>
          <span>
            {overview.profiles.active ?? "?"} active profile
            {overview.profiles.active === 1 ? "" : "s"}
            {overview.profiles.total != null
              ? ` of ${overview.profiles.total}`
              : ""}
          </span>
        </div>
        {overview.databaseError && (
          <p className="text-[11px] text-amber-300 mt-2">
            Database: {overview.databaseError}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Share links */}
        <Card>
          <SectionTitle
            title="Share links"
            subtitle="Temporary access to one profile. Expiry sends the visitor to the ad URL."
            right={<Badge tone="neutral">{activeLinks.length} active</Badge>}
          />
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Field label="Profile" className="flex-1">
              <Select value={slug} onChange={(event) => setSlug(event.target.value)}>
                {profiles.length === 0 && <option value="">No profiles yet</option>}
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.slug}>
                    {profile.name} (/{profile.slug})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lasts">
              <Select
                value={seconds}
                onChange={(event) => setSeconds(Number(event.target.value))}
              >
                {DURATIONS.map((entry) => (
                  <option key={entry.seconds} value={entry.seconds}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              className="mb-0.5"
              loading={busy === "link"}
              disabled={!slug}
              onClick={() => void addLink()}
            >
              <Link2 className="w-3.5 h-3.5" /> Create
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {activeLinks.length === 0 && (
              <p className="text-xs text-neutral-500">
                No active links. Create one above, then send it to the customer.
              </p>
            )}
            {activeLinks.map((link) => (
              <div
                key={link.token}
                className="rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">
                        /{link.slug}
                      </span>
                      <Badge tone="green">{timeLeft(link.expiresAt)}</Badge>
                      <span className="text-[10px] text-neutral-500">
                        {link.uses} open{link.uses === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 break-all mt-1">
                      {link.url}
                    </p>
                    <p className="text-[10px] text-neutral-600 mt-1">
                      expires {formatDate(link.expiresAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <CopyButton value={link.url} />
                    <button
                      type="button"
                      onClick={() => void removeLink(link.token)}
                      disabled={busy === `revoke:${link.token}`}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <Trash2 className="w-3 h-3" /> Revoke
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {activeLinks.length > 0 && (
              <Button
                variant="danger"
                className="w-full"
                loading={busy === "revoke:all"}
                onClick={() => void removeLink("all")}
              >
                <Ban className="w-3.5 h-3.5" /> Revoke every link
              </Button>
            )}
          </div>
        </Card>

        {/* Ad URL */}
        <div className="space-y-5">
          <Card>
            <SectionTitle
              title="Expired-link destination"
              subtitle="Where a visitor lands when a share link runs out."
            />
            <Field label="Ad URL" hint="Must start with http:// or https://">
              <TextInput
                value={adUrl}
                onChange={(event) => setAdUrl(event.target.value)}
                placeholder="https://example.com/offer"
              />
            </Field>
            <div className="flex gap-2 mt-3">
              <Button
                loading={busy === "ad"}
                onClick={() => void saveAdUrl(adUrl.trim() || null)}
              >
                <Megaphone className="w-3.5 h-3.5" /> Save
              </Button>
              <Button
                variant="ghost"
                disabled={busy === "ad" || !site.adUrl}
                onClick={() => void saveAdUrl(null)}
              >
                Clear
              </Button>
            </div>
            <p className="text-[11px] text-neutral-500 mt-3">
              {site.adUrl
                ? "Expired downloads of this link redirect here instead of showing a 404."
                : "With no ad URL, an expired link shows a neutral “link expired” page."}
            </p>
          </Card>

          <Card>
            <SectionTitle title="Deployment" subtitle="What this deployment can do." />
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ["KV binding", overview.configured.kv],
                ["Database", overview.configured.database],
                ["Telegram bot", overview.configured.telegram],
                ["Owner chat", overview.configured.ownerChat],
              ].map(([label, ok]) => (
                <div key={String(label)} className="flex items-center gap-2">
                  {ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-neutral-600" />
                  )}
                  <span className={ok ? "text-neutral-300" : "text-neutral-500"}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 mb-1.5">
                AI providers
              </p>
              <ul className="space-y-1 text-[11px] text-neutral-400">
                {overview.ai.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
