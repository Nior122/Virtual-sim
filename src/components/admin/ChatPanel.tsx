import { useEffect, useState } from "react";
import { MessageSquare, Send, Sparkles } from "lucide-react";
import {
  listProfiles,
  testChat,
  type ProfileSummary,
} from "../../lib/admin/client";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  SectionTitle,
  Select,
  Spinner,
  TextArea,
} from "./ui";

interface Turn {
  id: number;
  question: string;
  reply?: string;
  provider?: string;
  error?: string;
}

let nextTurn = 1;

export default function ChatPanel() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await listProfiles();
        setProfiles(data.profiles.filter((profile) => profile.active));
        setSlug((current) => current || data.profiles[0]?.slug || "");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const send = async () => {
    const question = message.trim();
    if (!question || !slug) return;
    setSending(true);
    setError("");
    const id = nextTurn++;
    setTurns((current) => [...current, { id, question }]);
    setMessage("");
    try {
      const result = await testChat(slug, question);
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id
            ? { ...turn, reply: result.reply, provider: result.provider }
            : turn
        )
      );
    } catch (err) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, error: (err as Error).message } : turn
        )
      );
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading profiles…" />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle
          title="Chat test"
          subtitle="Ask any published profile a question and see the real answer, with the provider that produced it."
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-end">
          <Field label="Profile">
            <Select value={slug} onChange={(event) => setSlug(event.target.value)}>
              {profiles.length === 0 && <option value="">No active profiles</option>}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.slug}>
                  {profile.name} (/{profile.slug})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Question">
            <TextArea
              rows={2}
              value={message}
              placeholder="Where are you from, and what are you doing tonight?"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between mt-3">
          <p className="text-[11px] text-neutral-500">
            Ctrl/⌘ + Enter sends. Nothing is posted to the public site.
          </p>
          <Button loading={sending} disabled={!slug || !message.trim()} onClick={() => void send()}>
            <Send className="w-3.5 h-3.5" /> Send
          </Button>
        </div>
      </Card>

      {turns.length === 0 ? (
        <Card>
          <div className="flex items-center gap-2 text-neutral-400 text-xs">
            <MessageSquare className="w-4 h-4" /> No test messages yet.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {turns.map((turn) => (
            <Card key={turn.id}>
              <p className="text-xs text-neutral-300">
                <span className="text-neutral-500">You:</span> {turn.question}
              </p>
              {turn.reply && (
                <p className="text-sm text-white mt-2 whitespace-pre-wrap">{turn.reply}</p>
              )}
              {turn.error && (
                <div className="mt-2">
                  <ErrorNote>{turn.error}</ErrorNote>
                </div>
              )}
              {turn.provider && (
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone="pink">
                    <Sparkles className="w-3 h-3 mr-1" /> {turn.provider}
                  </Badge>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
