import {
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { Check, Copy, Loader2 } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = "primary" | "ghost" | "danger" | "subtle";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 disabled:opacity-50",
  ghost:
    "border border-white/10 text-neutral-200 hover:bg-white/5 disabled:opacity-40",
  danger:
    "border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40",
  subtle: "bg-white/5 text-neutral-200 hover:bg-white/10 disabled:opacity-40",
};

export function Button({
  children,
  variant = "primary",
  loading = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors",
        VARIANTS[variant],
        className
      )}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  key?: string | number;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-neutral-400 mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-neutral-500 mt-1">{hint}</span>}
    </label>
  );
}

const CONTROL =
  "w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-pink-500/60";

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, className)} />;
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, "min-h-24 resize-y", className)} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CONTROL, "appearance-none", className)}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  key?: string | number;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-400 mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "pink" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/5 text-neutral-300 border-white/10",
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    pink: "bg-pink-500/10 text-pink-300 border-pink-500/30",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    red: "bg-red-500/10 text-red-300 border-red-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {children}
    </div>
  );
}

export function noticeColor(kind: "info" | "success" | "warn"): string {
  if (kind === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (kind === "warn") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-sky-500/30 bg-sky-500/10 text-sky-200";
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "success" | "warn";
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-xs", noticeColor(kind))}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be blocked; select-on-click still lets people copy.
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-neutral-300 hover:bg-white/5"
      title={value}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {label || (copied ? "Copied" : "Copy")}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
        checked ? "bg-pink-500" : "bg-white/15",
        disabled && "opacity-50"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label || "Loading…"}
    </div>
  );
}
