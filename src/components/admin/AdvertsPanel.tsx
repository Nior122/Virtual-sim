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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RotateCw,
  MousePointerClick,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatDate, getAds, saveAds } from "../../lib/admin/client";
import {
  BANNER_POSITIONS,
  DEFAULT_CLICK_URL,
  POPUNDER_MAX_COOLDOWN_SECONDS,
  POPUNDER_MAX_PER_SESSION,
  defaultAdSettings,
  snippetReport,
  type AdSettings,
  type BannerPosition,
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

const POSITION_LABEL: Record<BannerPosition, string> = {
  inline: "Inline — under the page content (never covers the chat)",
  "fixed-bottom": "Pinned to the bottom of the screen",
  "fixed-top": "Pinned to the top of the screen",
};

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
        <span className="text-[11px] text-neutral-500">
          {report.chars.toLocaleString()} characters · {report.scripts} script
          {report.scripts === 1 ? "" : "s"}
          {report.external ? ` (${report.external} external)` : ""}
        </span>
      </div>

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

  const live = [
    draft.popunder.enabled && draft.popunder.code.trim() ? "pop-under" : null,
    draft.socialBar.enabled && draft.socialBar.code.trim() ? "social bar" : null,
    draft.native.enabled && draft.native.code.trim() ? "native banner" : null,
  ].filter(Boolean) as string[];

  const clickOn = draft.enabled && draft.click.mode !== "off" && !!draft.click.url;

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
            ["Native banner", !!draft.native.enabled && !!draft.native.code.trim()],
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
          <Field
            label="Position"
            hint="Inline is the safe default. On the chat screen it sits below the chat, so a pinned bar is the only position that is seen there."
          >
            <Select
              value={draft.native.position}
              onChange={(event) =>
                patchDraft({
                  native: {
                    ...draft.native,
                    position: event.target.value as BannerPosition,
                  },
                })
              }
            >
              {BANNER_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {POSITION_LABEL[position]}
                </option>
              ))}
            </Select>
          </Field>
          {(draft.native.position === "fixed-bottom" ||
            draft.native.position === "fixed-top") && (
            <div className="mt-2">
              <Notice kind="warn">
                A pinned banner sits on top of the page. On the chat screen it can
                cover the message box on small phones — visitors can dismiss it with
                the ✕, and it stays dismissed for that session.
              </Notice>
            </div>
          )}
        </div>
      </CodeCard>

      {/* Guidance */}
      <Card>
        <SectionTitle
          title="What actually raises the payout"
          subtitle="Five rules that matter more than which network you pick."
          right={<Sparkles className="w-4 h-4 text-amber-300 shrink-0" />}
        />
        <ul className="space-y-2 text-[12px] text-neutral-300 leading-relaxed">
          {[
            "Paste the snippet exactly as the network gave it — an edited or re-typed tag is the number one reason an advert never appears.",
            "One snippet per format. The same code in two slots fires twice and networks read that as fraud; the panel refuses to save it.",
            "Keep the send-button click-through on “first click”: it earns on every conversation without a message ever being lost.",
            "Cap the pop-under. Traffic quality is what the network pays for, and a returning visitor is worth more than one extra open.",
            "Native banners earn most next to content, so leave it inline until you know the traffic can take a pinned bar.",
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
