import { useEffect, useState, type FormEvent } from "react";
import {
  BarChart3,
  Bot,
  Download,
  Lock,
  LogOut,
  ShieldCheck,
  Terminal,
  UserRound,
} from "lucide-react";
import {
  formatDate,
  getSession,
  login,
  logout,
  type SessionState,
} from "../lib/admin/client";
import { Button, Card, ErrorNote, Field, Spinner, TextInput } from "./admin/ui";
import OverviewPanel from "./admin/OverviewPanel";
import ProfilesPanel from "./admin/ProfilesPanel";
import ImportPanel from "./admin/ImportPanel";
import ChatPanel from "./admin/ChatPanel";
import ToolsPanel from "./admin/ToolsPanel";

type Tab = "overview" | "profiles" | "import" | "chat" | "tools";

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "profiles", label: "Profiles", icon: UserRound },
  { id: "import", label: "Import", icon: Download },
  { id: "chat", label: "Chat test", icon: Bot },
  { id: "tools", label: "Tools", icon: Terminal },
];

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function LoginScreen({
  session,
  onSuccess,
}: {
  session: SessionState;
  onSuccess: (state: SessionState) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(password);
      onSuccess({
        ...session,
        authenticated: true,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07080e] text-neutral-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <ShieldCheck className="w-5 h-5 text-pink-400" />
          <span className="text-sm font-semibold tracking-wide">Dream Babe · Backend</span>
        </div>

        {!session.configured ? (
          <Card>
            <h1 className="text-base font-semibold text-white">Backend disabled</h1>
            <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
              Set <code className="text-pink-300">ADMIN_PASSWORD</code> in Cloudflare
              Pages → Settings → Environment variables (at least 6 characters), then
              redeploy. That password is the only credential — there is no account
              database.
            </p>
            <p className="text-xs text-neutral-500 mt-3">
              Optional: <code>ADMIN_SESSION_HOURS</code> (default 12) and{" "}
              <code>ADMIN_SESSION_SECRET</code> (extra signing entropy).
            </p>
          </Card>
        ) : (
          <Card>
            <h1 className="text-base font-semibold text-white">Sign in</h1>
            <p className="text-xs text-neutral-400 mt-1">
              Private mode, share links, profiles and imports.
            </p>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <Field label="Password">
                <TextInput
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </Field>
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button type="submit" className="w-full" loading={busy} disabled={!password}>
                <Lock className="w-3.5 h-3.5" /> Sign in
              </Button>
            </form>
            <p className="text-[11px] text-neutral-500 mt-4">
              Sessions last {session.hours} hour{session.hours === 1 ? "" : "s"} and are
              signed, HttpOnly cookies. Changing the password logs every device out.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setSession(await getSession());
      } catch (err) {
        setError((err as Error).message);
        setSession({ configured: false, authenticated: false, expiresAt: null, hours: 12 });
      }
    })();
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen bg-[#07080e] flex items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (error && !session.configured) {
    return (
      <div className="min-h-screen bg-[#07080e] text-neutral-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </div>
    );
  }

  if (!session.authenticated) {
    return <LoginScreen session={session} onSuccess={setSession} />;
  }

  const signOut = async () => {
    try {
      await logout();
    } finally {
      setSession((current) =>
        current ? { ...current, authenticated: false, expiresAt: null } : current
      );
    }
  };

  const ActivePanel =
    tab === "overview"
      ? OverviewPanel
      : tab === "profiles"
        ? ProfilesPanel
        : tab === "import"
          ? ImportPanel
          : tab === "chat"
            ? ChatPanel
            : ToolsPanel;

  return (
    <div className="min-h-screen bg-[#07080e] text-neutral-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07080e]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-4 h-4 text-pink-400 shrink-0" />
            <span className="text-sm font-semibold truncate">Dream Babe · Backend</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-[11px] text-neutral-500">
              signed in until {formatDate(session.expiresAt)}
            </span>
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="w-3.5 h-3.5" /> Log out
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-4 sm:px-6 flex gap-1 overflow-x-auto pb-2">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors " +
                  (active
                    ? "bg-white/10 text-white"
                    : "text-neutral-400 hover:text-white hover:bg-white/5")
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {entry.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 pb-16">
        <ActivePanel />
      </main>
    </div>
  );
}
