import { useEffect, useState } from "react";
import { Activity, CheckCircle2, PlayCircle, Search, XCircle } from "lucide-react";
import {
  checkVideos,
  diagnose,
  getProfile,
  listProfiles,
  type Diagnostics,
  type ProfileSummary,
  type VideoCheck,
} from "../../lib/admin/client";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  SectionTitle,
  Select,
  TextInput,
} from "./ui";

export default function ToolsPanel() {
  const [url, setUrl] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagError, setDiagError] = useState("");

  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [slug, setSlug] = useState("");
  const [checks, setChecks] = useState<VideoCheck[]>([]);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await listProfiles();
        setProfiles(data.profiles);
        setSlug((current) => current || data.profiles[0]?.slug || "");
      } catch {
        // The panel still works for page diagnostics without a database.
      }
    })();
  }, []);

  const runDiag = async () => {
    setDiagBusy(true);
    setDiagError("");
    setDiagnostics(null);
    try {
      const result = await diagnose(url.trim());
      setDiagnostics(result.diagnostics);
    } catch (err) {
      setDiagError((err as Error).message);
    } finally {
      setDiagBusy(false);
    }
  };

  const runChecks = async () => {
    if (!slug) return;
    setCheckBusy(true);
    setCheckError("");
    setChecks([]);
    try {
      const { profile } = await getProfile(slug);
      const urls = (profile.videos || []).map((video) => video.url).filter(Boolean);
      if (urls.length === 0) {
        setCheckError("That profile has no videos.");
        return;
      }
      const result = await checkVideos(urls);
      setChecks(result.checks);
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Diagnose a page"
          subtitle="The same output as /diag in Telegram: status, image tags, which candidates actually answer as JPEG."
        />
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Field label="Page URL" className="flex-1">
            <TextInput
              value={url}
              placeholder="https://coomer.st/onlyfans/user/ava"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runDiag();
              }}
            />
          </Field>
          <Button className="mb-0.5" loading={diagBusy} disabled={!url.trim()} onClick={() => void runDiag()}>
            <Search className="w-3.5 h-3.5" /> Inspect
          </Button>
        </div>
        {diagError && (
          <div className="mt-3">
            <ErrorNote>{diagError}</ErrorNote>
          </div>
        )}

        {diagnostics && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Badge tone={diagnostics.status >= 200 && diagnostics.status < 400 ? "green" : "red"}>
                HTTP {diagnostics.status || "—"}
              </Badge>
              <Badge tone="neutral">{diagnostics.contentType || "no content-type"}</Badge>
              <Badge tone="neutral">{diagnostics.bytes.toLocaleString()} bytes</Badge>
              <Badge tone="neutral">{diagnostics.imgTags} img tags</Badge>
              <Badge tone="neutral">{diagnostics.sourceTags} source tags</Badge>
              {diagnostics.challenge && <Badge tone="amber">bot challenge</Badge>}
              {diagnostics.pageError && <Badge tone="amber">{diagnostics.pageError}</Badge>}
            </div>
            {diagnostics.title && (
              <p className="text-xs text-neutral-300">
                <span className="text-neutral-500">Title:</span> {diagnostics.title}
              </p>
            )}
            {diagnostics.error && <ErrorNote>{diagnostics.error}</ErrorNote>}

            {diagnostics.archive && (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-neutral-300">
                <p className="font-medium text-white">
                  Archive API · {diagnostics.archive.service}/{diagnostics.archive.user}
                </p>
                <p className="mt-1 text-neutral-400">
                  {diagnostics.archive.postCount} posts · {diagnostics.archive.imageUrls} images ·{" "}
                  {diagnostics.archive.videoUrls} videos
                  {diagnostics.archive.error ? ` · ${diagnostics.archive.error}` : ""}
                </p>
              </div>
            )}

            {[
              ["Verified JPEG", diagnostics.probes.filter((probe) => probe.ok)],
              ["Rejected", diagnostics.probes.filter((probe) => !probe.ok)],
            ].map(([label, probes]) => {
              const list = probes as Array<{ url: string; ok: boolean }>;
              if (list.length === 0) return null;
              return (
                <div key={String(label)}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 mb-1">
                    {String(label)} ({list.length})
                  </p>
                  <ul className="space-y-1">
                    {list.map((probe) => (
                      <li key={probe.url} className="flex items-start gap-2 text-[11px]">
                        {probe.ok ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                        )}
                        <a
                          href={probe.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-400 break-all hover:text-white"
                        >
                          {probe.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {diagnostics.nonJpegUrls.length > 0 && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 mb-1">
                  Not JPEG by extension ({diagnostics.nonJpegUrls.length})
                </p>
                <ul className="space-y-1">
                  {diagnostics.nonJpegUrls.map((candidate) => (
                    <li key={candidate} className="text-[11px] text-neutral-500 break-all">
                      {candidate}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Check a profile's videos"
          subtitle="HTTP status and content type for every stream URL the call screen will load."
        />
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Field label="Profile" className="flex-1">
            <Select value={slug} onChange={(event) => setSlug(event.target.value)}>
              {profiles.length === 0 && <option value="">No profiles</option>}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.slug}>
                  {profile.name} (/{profile.slug}) · {profile.videos} videos
                </option>
              ))}
            </Select>
          </Field>
          <Button className="mb-0.5" variant="ghost" loading={checkBusy} disabled={!slug} onClick={() => void runChecks()}>
            <PlayCircle className="w-3.5 h-3.5" /> Check videos
          </Button>
        </div>
        {checkError && (
          <div className="mt-3">
            <ErrorNote>{checkError}</ErrorNote>
          </div>
        )}
        {checks.length > 0 && (
          <ul className="mt-4 space-y-2">
            {checks.map((check) => (
              <li
                key={check.url}
                className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  {check.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span className="font-medium text-neutral-200">
                    {check.ok ? "Playable" : "Problem"}
                  </span>
                  <Badge tone="neutral">{check.status || "no response"}</Badge>
                  <span className="text-neutral-500">{check.contentType || "unknown type"}</span>
                </div>
                <p className="text-neutral-500 break-all mt-1">{check.url}</p>
                {check.error && <p className="text-red-300 mt-1">{check.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Health" subtitle="What the deployment reports." />
        <a
          href="/api/health"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs text-pink-300 hover:text-pink-200"
        >
          <Activity className="w-3.5 h-3.5" /> Open /api/health
        </a>
      </Card>
    </div>
  );
}
