// ---------------------------------------------------------------------------
// Adverts tab.
//
// Everything here writes the same KV record that /api/ads serves to the site,
// so a save is live on the next page — no deploy, no rebuild.
//
// The panel is deliberately opinionated about two things: an enabled slot with
// no code is called out (it silently earns nothing), and the same snippet in
// two slots is rejected by the API (double-firing gets accounts suspended).
// ---------------------------------------------------------------------------
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  ExternalLink,
  RotateCw,
  MousePointerClick,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatDate, getAds, saveAds } from "../../lib/admin/client";
import { buildFrame } from "../../lib/ads/inject";
import {
  DEFAULT_CLICK_URL,
  HOUSE_TEXT_LIMITS,
  POPUNDER_MAX_COOLDOWN_SECONDS,
  POPUNDER_MAX_PER_SESSION,
  defaultAdSettings,
  snippetReport,
  usesHouseBanner,
  type AdSettings,
  type ClickMode,
} from "../../lib/ads/config";
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
  Toggle,
} from "./ui";

const CLICK_MODE_LABEL: Record<ClickMode, string> = {
  first: "First click opens it, the next click sends",
  every: "Every send click opens it — and the message is sent too",
  off: "Never — the send button only sends",
};


// ---------------------------------------------------------------------------
// Live preview: run the drafted snippet in a sealed frame
//
// "I pasted the code and nothing happened" is impossible to debug from a
// textarea. This mounts the exact snippet the way the site will, but always in
// the sandboxed frame, so a network that draws nothing is visible as an empty
// box instead of a mystery.
// ---------------------------------------------------------------------------
function SnippetPreview({ code, height = 140 }: { code: string; height?: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [runId, setRunId] = useState(0);
  const [ran, setRan] = useState(false);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    setRan(false);
    if (!code.trim()) return;
    const frame = buildFrame(code, height);
    frame.addEventListener("load", () => setRan(true));
    mount.appendChild(frame);
    return () => mount.replaceChildren();
  }, [code, height, runId]);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Button variant="ghost" onClick={() => setRunId((n) => n + 1)}>
          <RefreshCw className="w-3.5 h-3.5" /> Run again
        </Button>
        <span className="text-[11px] text-neutral-500">
          {ran
            ? "Frame loaded. If it is blank, the network returned no creative for this browser — try a private window with no ad blocker."
            : "Running…"}
        </span>
      </div>
      <div
        ref={host}
        className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] overflow-hidden"
        style={{ minHeight: 40 }}
      />
      <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
        Runs in an isolated frame with your own network code. It never touches the
        chat page, and a preview may count as one request in your network dashboard.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One ad-format card
// ---------------------------------------------------------------------------
function CodeCard({
  title,
  description,
  placeholder,
  enabled,
  code,
  onEnabled,
  onCode,
  onSave,
  onClear,
  busy,
  children,
}: {
  title: string;
  description: string;
  placeholder: string;
  enabled: boolean;
  code: string;
  onEnabled: (next: boolean) => void;
  onCode: (next: string) => void;
  onSave: () => void;
  onClear: () => void;
  busy: boolean;
  children?: ReactNode;
}) {
  const report = useMemo(() => snippetReport(code), [code]);
  const empty = !code.trim();
  const [showPreview, setShowPreview] = useState(false);

  return (
    <Card>
      <SectionTitle
        title={title}
        subtitle={description}
        right={
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={enabled && !empty ? "green" : empty ? "neutral" : "amber"}>
              {empty ? "empty" : enabled ? "live" : "paused"}
            </Badge>
            <Toggle checked={enabled} onChange={onEnabled} label={`${title} on`} />
          </div>
        }
      />

      <TextArea
        value={code}
        onChange={(event) => onCode(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="min-h-32 font-mono text-[11px] leading-relaxed"
      />

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <Button loading={busy} onClick={onSave} disabled={busy}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Save
        </Button>
        <Button
          variant="ghost"
          onClick={onClear}
          disabled={busy || empty}
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </Button>
        <Button
          variant="ghost"
          onClick={() => setShowPreview((v) => !v)}
          disabled={empty}
        >
          <FlaskConical className="w-3.5 h-3.5" />
          {showPreview ? "Hide test" : "Test code"}
        </Button>
        <span className="text-[11px] text-neutral-500">
          {report.chars.toLocaleString()} characters · {report.scripts} script
          {report.scripts === 1 ? "" : "s"}
          {report.external ? ` (${report.external} external)` : ""}
        </span>
      </div>

      {showPreview && !empty && <SnippetPreview code={code} />}

      {enabled && empty && (
        <div className="mt-3">
          <Notice kind="warn">
            Switched on but empty — this format shows nothing until you paste the
            network's code.
          </Notice>
        </div>
      )}

      {report.hosts.length > 0 && (
        <p className="text-[11px] text-neutral-500 mt-3 break-all">
          Calls: {report.hosts.join(", ")}
        </p>
      )}

      {report.usesDocumentWrite && (
        <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
          This snippet uses <code className="text-neutral-300">document.write</code>.
          It is mounted in an isolated, sandboxed frame — run in the page itself it
          would erase everything on screen.
        </p>
      )}

      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export default function AdvertsPanel() {
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [draft, setDraft] = useState<AdSettings>(defaultAdSettings());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getAds();
      setSettings(next);
      setDraft(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (key: string, patch: Partial<AdSettings>, message: string) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const next = await saveAds(patch);
      setSettings(next);
      setDraft(next);
      setNotice(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patchDraft = (patch: Partial<AdSettings>) =>
    setDraft((current) => ({ ...current, ...patch }));

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner label="Loading advert settings…" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-3">
        <ErrorNote>{error || "Could not load the advert settings."}</ErrorNote>
        <Button onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </Button>
      </div>
    );
  }



  const clickOn = draft.enabled && draft.click.mode !== "off" && !!draft.click.url;

  /**
   * "Live" means a visitor can actually see this format.
   *
   * The native slot is the one that can be live without pasted code: its
   * in-page component draws the house banner when the box is empty. Showing
   * "off" there when something *is* on screen is exactly the kind of mismatch
   * that makes an owner think the banner is broken.
   */
  const houseOn = usesHouseBanner(draft);
  const nativeLive =
    draft.enabled &&
    draft.native.enabled &&
    (!!draft.native.code.trim() || houseOn);

  const live = [
    draft.popunder.enabled && draft.popunder.code.trim() ? "pop-under" : null,
    draft.socialBar.enabled && draft.socialBar.code.trim() ? "social bar" : null,
    draft.native.enabled && draft.native.code.trim()
      ? "native banner"
      : houseOn
        ? "house banner (built-in)"
        : null,
  ].filter(Boolean) as string[];

  // Formats the owner switched on but left without code: on paper "live", in
  // reality invisible. This is the state that produces "the adverts are not
  // showing".
  // Formats with the switch on, no network code, and nothing drawn in their
  // place: they earn nothing until the owner pastes a snippet.
  const idle = [
    draft.popunder.enabled && !draft.popunder.code.trim() ? "pop-under" : null,
    draft.socialBar.enabled && !draft.socialBar.code.trim() ? "social bar" : null,
    draft.native.enabled && !draft.native.code.trim() && !houseOn
      ? "native banner"
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* Status */}
      <Card>
        <SectionTitle
          title="Adverts"
          subtitle="Paste network code once — it applies to the whole site immediately, with no deploy."
          right={
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={draft.enabled ? "green" : "red"}>
                {draft.enabled ? "ads on" : "ads off"}
              </Badge>
              <Toggle
                checked={draft.enabled}
                onChange={(next) =>
                  void save(
                    "master",
                    { enabled: next },
                    next ? "Adverts are live." : "Every advert is now off."
                  )
                }
                label="Adverts on"
                disabled={busy === "master"}
              />
            </div>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          {[
            ["Send button", clickOn],
            ["Pop-under", !!draft.popunder.enabled && !!draft.popunder.code.trim()],
            ["Social bar", !!draft.socialBar.enabled && !!draft.socialBar.code.trim()],
            ["Native banner", nativeLive],
          ].map(([label, on]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 flex items-center justify-between gap-2"
            >
              <span className="text-neutral-300">{label}</span>
              <span
                className={
                  on
                    ? "text-[10px] font-semibold uppercase tracking-wide text-emerald-300"
                    : "text-[10px] font-semibold uppercase tracking-wide text-neutral-500"
                }
              >
                {on ? "live" : "off"}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-neutral-500 mt-3">
          {live.length
            ? `Third-party code running now: ${live.join(", ")}.`
            : "No third-party code is running — only the send-button click-through."}{" "}
          Last saved {formatDate(settings.updatedAt)}
        </p>

        {draft.enabled && idle.length > 0 && (
          <div className="mt-3">
            <Notice kind="warn">
              Switched on but empty ({idle.join(", ")}): visitors see nothing from{" "}
              {idle.length === 1 ? "this format" : "these formats"}, so it earns
              nothing. Paste the code your network gives you into the box below and
              press Save.
              {draft.native.enabled && !draft.native.code.trim() && houseOn
                ? " The native banner is the exception: until you paste its code it shows the built-in house banner, which is on."
                : ""}
            </Notice>
          </div>
        )}

        <details className="mt-3 text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none">
            An advert is still not showing — how do I find out why?
          </summary>
          <div className="mt-2 space-y-1.5 leading-relaxed">
            <p>
              Open the live site, then the browser console (F12), and run{" "}
              <code className="text-neutral-300">__dgAds()</code>. It lists every
              format and the exact reason it did or did not run:{" "}
              <code className="text-neutral-300">empty-code</code>,{" "}
              <code className="text-neutral-300">disabled</code>,{" "}
              <code className="text-neutral-300">not-allowed-on-route</code>,{" "}
              <code className="text-neutral-300">capped</code> or{" "}
              <code className="text-neutral-300">injected</code>.
            </p>
            <p>
              A snippet that is only <code className="text-neutral-300">&lt;script src&gt;</code>{" "}
              is fine — it is injected as a real script tag, so it runs. Use{" "}
              <strong>Test code</strong> above to see the creative before saving.
            </p>
          </div>
        </details>

        {!draft.enabled && (
          <div className="mt-3">
            <Notice kind="warn">
              The master switch is off, so <strong>nothing</strong> runs — including
              the send-button click-through.
            </Notice>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {notice && (
          <div className="mt-3">
            <Notice kind="success">{notice}</Notice>
          </div>
        )}
      </Card>

      {/* Send button */}
      <Card>
        <SectionTitle
          title="Send-message button"
          subtitle="Inside a profile inbox, the send arrow. This is the highest-converting slot on the site."
          right={<MousePointerClick className="w-4 h-4 text-pink-400 shrink-0" />}
        />

        <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
          <Field
            label="Click-through URL"
            hint="Opens in a new tab. Must start with http:// or https://"
          >
            <TextInput
              value={draft.click.url}
              onChange={(event) =>
                patchDraft({ click: { ...draft.click, url: event.target.value } })
              }
              placeholder={DEFAULT_CLICK_URL}
              spellCheck={false}
            />
          </Field>
          <Field label="When it opens">
            <Select
              value={draft.click.mode}
              onChange={(event) =>
                patchDraft({
                  click: { ...draft.click, mode: event.target.value as ClickMode },
                })
              }
            >
              {(Object.keys(CLICK_MODE_LABEL) as ClickMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {CLICK_MODE_LABEL[mode]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            loading={busy === "click"}
            onClick={() =>
              void save(
                "click",
                { click: { url: draft.click.url.trim(), mode: draft.click.mode } },
                "The send button now uses that link."
              )
            }
            disabled={busy === "click"}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              patchDraft({ click: { ...draft.click, url: DEFAULT_CLICK_URL } });
              void save(
                "click",
                { click: { url: DEFAULT_CLICK_URL, mode: draft.click.mode } },
                "Restored the built-in link."
              );
            }}
            disabled={busy === "click" || draft.click.url === DEFAULT_CLICK_URL}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Built-in link
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void save(
                "click",
                { click: { url: "", mode: "off" } },
                "The send button now only sends."
              )
            }
            disabled={busy === "click"}
          >
            <Trash2 className="w-3.5 h-3.5" /> Turn off
          </Button>
          {/^https?:\/\//i.test(draft.click.url) && (
            <Button
              variant="ghost"
              onClick={() =>
                window.open(draft.click.url, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="w-3.5 h-3.5" /> Test link
            </Button>
          )}
        </div>

        <p className="text-[11px] text-neutral-500 mt-3 leading-relaxed">
          {draft.click.mode === "first"
            ? "First click: the advert opens and the message is not sent. Second click: the message is sent, and the next message repeats the cycle."
            : draft.click.mode === "every"
              ? "Every click: the advert opens and the message is sent in the same click. Highest revenue, most intrusive."
              : "Off: the send button only sends the message."}
        </p>
      </Card>

      {/* Placement */}
      <Card>
        <SectionTitle
          title="Where adverts run"
          subtitle="Applies to every inserted format. /admin is always excluded."
        />
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            {
              key: "home" as const,
              label: "Home + browse page",
              hint: "The landing page and /dreamgirls",
            },
            {
              key: "profiles" as const,
              label: "Profile + chat pages",
              hint: "Where visitors watch a profile",
            },
          ].map((entry) => (
            <div
              key={entry.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-white">{entry.label}</p>
                <p className="text-[11px] text-neutral-500">{entry.hint}</p>
              </div>
              <Toggle
                checked={draft.placements[entry.key]}
                onChange={(next) =>
                  patchDraft({
                    placements: { ...draft.placements, [entry.key]: next },
                  })
                }
                label={entry.label}
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button
            loading={busy === "placement"}
            onClick={() =>
              void save(
                "placement",
                { placements: draft.placements },
                "Placement saved."
              )
            }
            disabled={busy === "placement"}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Save placement
          </Button>
        </div>
      </Card>

      {/* Pop-under */}
      <CodeCard
        title="Pop-under"
        description="Adsterra, PropellerAds and similar “popunder” scripts. Opens once behind the page."
        placeholder={`<script src="https://your-network.example/popunder.js"></script>`}
        enabled={draft.popunder.enabled}
        code={draft.popunder.code}
        onEnabled={(next) =>
          patchDraft({ popunder: { ...draft.popunder, enabled: next } })
        }
        onCode={(next) => patchDraft({ popunder: { ...draft.popunder, code: next } })}
        onSave={() =>
          void save(
            "popunder",
            { popunder: draft.popunder, limits: draft.limits },
            "Pop-under saved."
          )
        }
        onClear={() =>
          void save(
            "popunder",
            { popunder: { enabled: false, code: "" } },
            "Pop-under removed."
          )
        }
        busy={busy === "popunder"}
      >
        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/[0.06]">
          <Field
            label="Max per visit"
            hint={`0–${POPUNDER_MAX_PER_SESSION}. 0 = never.`}
          >
            <TextInput
              type="number"
              min={0}
              max={POPUNDER_MAX_PER_SESSION}
              value={draft.limits.popunderPerSession}
              onChange={(event) =>
                patchDraft({
                  limits: {
                    ...draft.limits,
                    popunderPerSession: Number(event.target.value),
                  },
                })
              }
            />
          </Field>
          <Field
            label="Cool-down (seconds)"
            hint={`0–${POPUNDER_MAX_COOLDOWN_SECONDS} between two opens`}
          >
            <TextInput
              type="number"
              min={0}
              max={POPUNDER_MAX_COOLDOWN_SECONDS}
              value={draft.limits.popunderCooldownSeconds}
              onChange={(event) =>
                patchDraft({
                  limits: {
                    ...draft.limits,
                    popunderCooldownSeconds: Number(event.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
        <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
          A cap is not a limitation, it is protection: visitors who get a pop-under
          on every page stop coming back, and the network keeps paying less for the
          traffic. Three per visit is a good ceiling.
        </p>
      </CodeCard>

      {/* Social bar */}
      <CodeCard
        title="Social bar"
        description="The small bar that slides in on mobile and desktop and stays on screen."
        placeholder={`<script src="https://your-network.example/socialbar.js"></script>`}
        enabled={draft.socialBar.enabled}
        code={draft.socialBar.code}
        onEnabled={(next) =>
          patchDraft({ socialBar: { ...draft.socialBar, enabled: next } })
        }
        onCode={(next) =>
          patchDraft({ socialBar: { ...draft.socialBar, code: next } })
        }
        onSave={() =>
          void save("socialBar", { socialBar: draft.socialBar }, "Social bar saved.")
        }
        onClear={() =>
          void save(
            "socialBar",
            { socialBar: { enabled: false, code: "" } },
            "Social bar removed."
          )
        }
        busy={busy === "socialBar"}
      />

      {/* Native banner */}
      <CodeCard
        title="Native banner"
        description="The in-page “sponsored” block. Native networks usually pay more when it sits next to real content."
        placeholder={`<script async data-cfasync="false" src="https://your-network.example/native.js"></script>`}
        enabled={draft.native.enabled}
        code={draft.native.code}
        onEnabled={(next) =>
          patchDraft({ native: { ...draft.native, enabled: next } })
        }
        onCode={(next) => patchDraft({ native: { ...draft.native, code: next } })}
        onSave={() =>
          void save("native", { native: draft.native }, "Native banner saved.")
        }
        onClear={() =>
          void save(
            "native",
            { native: { ...draft.native, enabled: false, code: "" } },
            "Native banner removed."
          )
        }
        busy={busy === "native"}
      >
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            <strong className="text-neutral-200">Where it appears:</strong> at the
            bottom of every page — home, browse and each profile — directly above
            the footer, in the normal flow, so it scrolls with the content like any
            other block. It is never pinned over the page.
          </p>
          <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
            The banner is placed bare: no “Advertisement” label, no border, no
            background, no shadow. Whatever frame you see comes from the network's
            own creative.
          </p>
        </div>
      </CodeCard>

      {/* House banner — the fallback creative */}
      <Card>
        <SectionTitle
          title="Built-in banner"
          subtitle="Shown wherever the native banner is placed while its code box is empty — so a switched-on slot never displays a blank space. Pasted network code always replaces it."
          right={
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={houseOn ? "green" : "neutral"}>
                {houseOn ? "in use" : "idle"}
              </Badge>
              <Toggle
                checked={draft.house.enabled}
                onChange={(next) =>
                  patchDraft({ house: { ...draft.house, enabled: next } })
                }
                label="Built-in banner on"
              />
            </div>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Headline" hint={`Up to ${HOUSE_TEXT_LIMITS.headline} characters.`}>
            <TextInput
              value={draft.house.headline}
              maxLength={HOUSE_TEXT_LIMITS.headline}
              onChange={(event) =>
                patchDraft({
                  house: { ...draft.house, headline: event.target.value },
                })
              }
            />
          </Field>
          <Field label="Button label" hint={`Up to ${HOUSE_TEXT_LIMITS.cta} characters.`}>
            <TextInput
              value={draft.house.cta}
              maxLength={HOUSE_TEXT_LIMITS.cta}
              onChange={(event) =>
                patchDraft({ house: { ...draft.house, cta: event.target.value } })
              }
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Supporting line" hint={`Up to ${HOUSE_TEXT_LIMITS.body} characters.`}>
            <TextArea
              value={draft.house.body}
              maxLength={HOUSE_TEXT_LIMITS.body}
              onChange={(event) =>
                patchDraft({ house: { ...draft.house, body: event.target.value } })
              }
              className="min-h-16"
            />
          </Field>
        </div>

        {/* Live preview, in the site's own markup */}
        <div className="mt-4">
          <p className="text-[11px] text-neutral-500 mb-2">Preview</p>
          <div className="rounded-2xl bg-[#0b0d16] p-3">
            <div className="w-full px-1 py-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold text-white tracking-tight">
                    {draft.house.headline || "…"}
                  </p>
                  <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                    {draft.house.body || "…"}
                  </p>
                </div>
                <span className="shrink-0 px-5 py-2.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea]">
                  {draft.house.cta || "…"}
                </span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
            The button opens the <strong>click-through URL</strong> from the send
            button card — that is the link the banner earns on. Change it there if
            you want the banner to point somewhere else.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button
            loading={busy === "house"}
            onClick={() =>
              void save("house", { house: draft.house }, "Built-in banner saved.")
            }
            disabled={busy === "house"}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Save banner
          </Button>
          <Button
            variant="ghost"
            disabled={busy === "house"}
            onClick={() =>
              void save(
                "house",
                { house: defaultAdSettings().house },
                "Built-in banner restored to the default wording."
              )
            }
          >
            <RotateCw className="w-3.5 h-3.5" /> Restore default wording
          </Button>
        </div>
      </Card>

      {/* Guidance */}
      <Card>
        <SectionTitle
          title="What actually raises the payout"
          subtitle="Five rules that matter more than which network you pick."
          right={<Sparkles className="w-4 h-4 text-amber-300 shrink-0" />}
        />
        <ul className="space-y-2 text-[12px] text-neutral-300 leading-relaxed">
          {[
            "Paste the snippet exactly as the network gave it — an edited or re-typed tag is the number one reason an advert never appears. “Test code” shows what it draws before you save.",
            "One snippet per format. The same code in two slots fires twice and networks read that as fraud; the panel refuses to save it.",
            "Keep the send-button click-through on “first click”: it earns on every conversation without a message ever being lost.",
            "Never leave a slot switched on and empty. The native banner falls back to the built-in one, but a pop-under or social bar with no code is pure lost revenue.",
            "Cap the pop-under. Traffic quality is what the network pays for, and a returning visitor is worth more than one extra open.",
            "Native banners earn most next to content, so leave it inline until you know the traffic can take a pinned bar.",
            "The built-in banner needs no network, so it can run from day one — give it a concrete headline (“online now”, a number) rather than a slogan, and point its button at the same click-through as the send button.",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            Advert code runs in your visitors' browsers and can do anything a script
            can. Only paste code from a network you signed up with, and if a campaign
            starts redirecting visitors away from the site, switch it off here — the
            change applies on the next page load.
          </p>
        </div>
        <div className="mt-4">
          <Button
            variant="ghost"
            onClick={() => {
              const reset = defaultAdSettings();
              patchDraft(reset);
              void save(
                "reset",
                reset,
                "Every advert slot cleared. The send button is back on the built-in link."
              );
            }}
            disabled={!!busy}
          >
            <RotateCw className="w-3.5 h-3.5" /> Reset everything
          </Button>
        </div>
      </Card>
    </div>
  );
}
