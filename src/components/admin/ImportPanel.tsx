import { useState } from "react";
import { CheckCircle2, Link2, Loader2, Trash2, Wand2 } from "lucide-react";
import {
  commitImport,
  prepareImport,
  type PreparedEntry,
} from "../../lib/admin/client";
import { ProfileLinkActions } from "./ProfileLinkActions";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Notice,
  SectionTitle,
  Spinner,
  TextArea,
} from "./ui";

type Status = "queued" | "preparing" | "ready" | "error" | "committing" | "done";

interface Item {
  id: number;
  raw: string;
  status: Status;
  prepared?: PreparedEntry;
  error?: string;
  result?: { slug?: string; link?: string; videos?: number; images?: number };
}

let nextId = 1;

export default function ImportPanel() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");


  const patch = (id: number, changes: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item))
    );

  const prepareAll = async () => {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError("Paste at least one profile URL — one per line.");
      return;
    }
    setError("");
    setNotice("");
    setRunning(true);
    const queued: Item[] = lines.map((raw) => ({
      id: nextId++,
      raw,
      status: "queued",
    }));
    setItems(queued);

    for (const item of queued) {
      patch(item.id, { status: "preparing" });
      try {
        const response = await prepareImport(item.raw);
        if (!response.ok || !response.prepared) {
          patch(item.id, { status: "error", error: response.error || "Nothing found." });
        } else {
          patch(item.id, { status: "ready", prepared: response.prepared });
        }
      } catch (err) {
        patch(item.id, { status: "error", error: (err as Error).message });
      }
    }
    setRunning(false);
  };

  const commitOne = async (item: Item) => {
    if (!item.prepared) return;
    patch(item.id, { status: "committing" });
    try {
      const { result } = await commitImport(item.prepared);
      if (!result.ok) {
        patch(item.id, { status: "error", error: result.error || "Could not create it." });
        return;
      }
      patch(item.id, {
        status: "done",
        result: {
          slug: result.slug,
          link: result.link,
          videos: result.videos,
          images: result.images,
        },
      });
      setNotice(`Created /${result.slug}.`);
    } catch (err) {
      patch(item.id, { status: "error", error: (err as Error).message });
    }
  };

  const commitReady = async () => {
    setRunning(true);
    for (const item of items.filter((entry) => entry.status === "ready")) {
      // Read the latest state to avoid committing something already done.
      await commitOne(item);
    }
    setRunning(false);
  };

  const readyCount = items.filter((item) => item.status === "ready").length;

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Import a profile from a page"
          subtitle="Exactly like /scrape in Telegram: nothing is written until you press Create."
        />
        <Field
          label="Profile URLs"
          hint="One per line. Use “images: <url> videos: <url>” to take the two from different pages."
        >
          <TextArea
            rows={5}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={"https://coomer.st/onlyfans/user/ava\nhttps://example.com/models/mia"}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button loading={running} onClick={() => void prepareAll()}>
            <Wand2 className="w-3.5 h-3.5" /> Scrape & prepare
          </Button>
          {readyCount > 0 && (
            <Button variant="subtle" disabled={running} onClick={() => void commitReady()}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Create all ready ({readyCount})
            </Button>
          )}
          {(items.length > 0 || input) && (
            <Button
              variant="ghost"
              disabled={running}
              onClick={() => {
                setItems([]);
                setInput("");
                setError("");
                setNotice("");
              }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
        <p className="text-[11px] text-neutral-500 mt-3">
          Preparing opens the page, verifies every image is a real JPEG, collects
          playable videos and writes the profile text with your AI provider.
          Up to 25 URLs; each one is prepared separately so a slow page does not
          block the others.
        </p>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {items.length === 0 ? (
        <Card>
          <p className="text-xs text-neutral-500">
            Nothing queued yet. Paste one or more profile URLs above.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-white break-all">
                      {item.prepared?.name || item.raw}
                    </span>
                    {item.prepared && (
                      <span className="text-[11px] text-neutral-500">
                        /{item.prepared.slug}
                      </span>
                    )}
                    {item.status === "queued" && <Badge tone="neutral">queued</Badge>}
                    {item.status === "preparing" && <Badge tone="neutral">preparing</Badge>}
                    {item.status === "ready" && <Badge tone="pink">ready</Badge>}
                    {item.status === "committing" && <Badge tone="neutral">creating</Badge>}
                    {item.status === "done" && <Badge tone="green">created</Badge>}
                    {item.status === "error" && <Badge tone="red">failed</Badge>}
                  </div>
                  <p className="text-[11px] text-neutral-500 break-all mt-1">{item.raw}</p>
                </div>
                <div className="flex items-center gap-2">
                  {item.status === "ready" && (
                    <Button loading={item.status === "committing"} onClick={() => void commitOne(item)}>
                      Create profile
                    </Button>
                  )}
                  {item.status === "preparing" && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
                  {item.status === "done" && item.result?.slug && (
                    <ProfileLinkActions slug={item.result.slug} />
                  )}
                  <button
                    type="button"
                    title="Remove from list"
                    onClick={() =>
                      setItems((current) => current.filter((entry) => entry.id !== item.id))
                    }
                    className="text-neutral-500 hover:text-red-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {item.error && (
                <div className="mt-3">
                  <ErrorNote>{item.error}</ErrorNote>
                </div>
              )}

              {item.prepared && (
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="flex gap-2 flex-wrap">
                      {item.prepared.images.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="w-16 h-16 rounded-lg overflow-hidden border border-white/10 bg-black/40"
                          title={url}
                        >
                          <img
                            src={url}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(event) => {
                              (event.target as HTMLImageElement).style.opacity = "0.15";
                            }}
                          />
                        </a>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-neutral-400">
                      <span className="inline-flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> {item.prepared.images.length} images
                      </span>
                      <span>{item.prepared.videos.length} videos</span>
                      {item.prepared.skippedVideos > 0 && (
                        <span className="text-amber-300">
                          {item.prepared.skippedVideos} embed(s) skipped
                        </span>
                      )}
                      {item.prepared.usedFallbackText && (
                        <span className="text-amber-300">AI failed — fallback text used</span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-neutral-400 space-y-1">
                    <p className="text-neutral-200 font-medium">
                      {item.prepared.draft?.name}
                      {item.prepared.draft?.age ? `, ${item.prepared.draft.age}` : ""}
                      {item.prepared.draft?.city ? ` · ${item.prepared.draft.city}` : ""}
                    </p>
                    <p className="line-clamp-4">{item.prepared.draft?.description}</p>
                    {item.prepared.draft?.personality && (
                      <p className="text-neutral-500">
                        <span className="text-neutral-400">Personality:</span>{" "}
                        {item.prepared.draft.personality}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
          {running && <Spinner label="Working through the list…" />}
        </div>
      )}
    </div>
  );
}
