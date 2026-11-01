// ---------------------------------------------------------------------------
// "Is this URL actually a JPEG?" — the one check the whole media pipeline uses.
//
// The previous version answered a simpler question than it needed to, and the
// answer it could not give came out as "rejected":
//
//   • it always sent a `Referer` — but the site renders photos with
//     `referrerPolicy="no-referrer"`, so a CDN with hotlink protection blocked
//     the Worker while the visitor's browser would have loaded the photo;
//   • it spent two requests per URL (HEAD, then a ranged GET), which burns the
//     Workers subrequest budget and is slow enough in series that the probe
//     deadline cut whole galleries off;
//   • anything that was not a clean "200 + image/jpeg" — a 403, a timeout, an
//     exhausted subrequest budget — was reported as "not a JPEG".
//
// So the check now returns four verdicts instead of a boolean:
//
//   jpeg       the server really returns a JPEG (type or magic bytes)
//   not-jpeg   the server really returns something else (WebP, PNG, a web page)
//   dead       the link is gone (404/410/451)
//   blocked    nothing could be proven: 401/403/429/5xx, timeout, network,
//              subrequest limit
//
// "blocked" is not a failure of the image, it is a failure of the check, and
// callers treat it accordingly: an unverifiable URL is kept rather than dropped,
// because the browser that will display it is not the Worker.
// ---------------------------------------------------------------------------

export type JpegVerdict = "jpeg" | "not-jpeg" | "dead" | "blocked";

export interface JpegProbe {
  url: string;
  verdict: JpegVerdict;
  /** Short, user-facing reason, e.g. "serves image/webp" or "HTTP 403". */
  reason: string;
  httpStatus?: number;
  contentType?: string;
  /** Which attempt produced the answer: "direct", "referer", "range". */
  via?: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Ask for images first; a missing Accept gets HTML from some CDNs. */
const IMAGE_ACCEPT =
  "image/avif,image/webp,image/apng,image/jpeg,image/*;q=0.9,*/*;q=0.8";

const ATTEMPT_TIMEOUT_MS = 7000;

/** Bytes read from the start of a file to identify the format. */
const SNIFF_BYTES = 64;

type Sniffed = "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp" | "html" | "json" | null;

/** Identify a file from its first bytes — the only type check that cannot lie. */
export function sniffBytes(bytes: Uint8Array): Sniffed {
  if (bytes.length < 3) return null;
  const at = (index: number) => bytes[index] ?? 0;
  const ascii = (start: number, length: number) =>
    Array.from(bytes.slice(start, start + length))
      .map((byte) => String.fromCharCode(byte))
      .join("");

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (ascii(0, 3) === "GIF") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).toLowerCase();
    if (brand === "avif" || brand === "avis") return "avif";
  }
  if (at(0) === 0x42 && at(1) === 0x4d) return "bmp";

  const head = ascii(0, Math.min(bytes.length, SNIFF_BYTES))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<")) {
    return "html";
  }
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  return null;
}

/** Read (and discard) just enough of a response to identify it. */
async function sniffResponse(res: Response): Promise<Sniffed> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  try {
    const { value } = await reader.read();
    if (!value) return null;
    return sniffBytes(value.subarray(0, SNIFF_BYTES));
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
}

const SNIFF_LABEL: Record<string, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  gif: "GIF",
  avif: "AVIF",
  bmp: "BMP",
};

function typeOf(res: Response): string {
  return (res.headers.get("content-type") || "").toLowerCase().trim();
}

/**
 * An image content-type that is decisive on its own. `image/jpg` is sent by a
 * lot of servers for real JPEGs even though it is not a registered type.
 */
function imageTypeVerdict(type: string): JpegVerdict | null {
  if (!type) return null;
  if (type.startsWith("image/jpeg") || type.startsWith("image/jpg")) return "jpeg";
  if (/^image\/(?:png|webp|gif|avif|svg|bmp|tiff|x-icon|vnd\.microsoft\.icon)/.test(type)) {
    return "not-jpeg";
  }
  return null;
}

/** Turn one HTTP response into a verdict. */
async function classify(res: Response): Promise<{
  verdict: JpegVerdict;
  reason: string;
}> {
  const status = res.status;
  const type = typeOf(res);

  if (status === 404 || status === 410 || status === 451) {
    res.body?.cancel().catch(() => {});
    return { verdict: "dead", reason: `HTTP ${status} (link gone)` };
  }
  if (status === 401 || status === 403 || status === 429) {
    res.body?.cancel().catch(() => {});
    return { verdict: "blocked", reason: `HTTP ${status} (hotlink or bot protection)` };
  }
  if (status >= 500) {
    res.body?.cancel().catch(() => {});
    return { verdict: "blocked", reason: `HTTP ${status} (server error)` };
  }
  if (status !== 200 && status !== 206 && status !== 416) {
    res.body?.cancel().catch(() => {});
    return { verdict: "blocked", reason: `HTTP ${status}` };
  }

  // 416 means the server disliked our Range, not that the file is bad.
  const magic = status === 416 ? null : await sniffResponse(res);

  if (magic === "jpeg") return { verdict: "jpeg", reason: "JPEG bytes" };

  const byType = imageTypeVerdict(type);
  if (byType === "jpeg") return { verdict: "jpeg", reason: `serves ${type}` };
  if (byType === "not-jpeg") {
    return { verdict: "not-jpeg", reason: `serves ${type}${magic ? ` (${SNIFF_LABEL[magic] || magic} bytes)` : ""}` };
  }
  if (magic && magic !== "html" && magic !== "json") {
    return { verdict: "not-jpeg", reason: `bytes are ${SNIFF_LABEL[magic] || magic}` };
  }
  if (magic === "html") {
    return { verdict: "not-jpeg", reason: "answers with a web page, not an image" };
  }
  if (magic === "json") {
    return { verdict: "not-jpeg", reason: "answers with JSON, not an image" };
  }
  // A 200 with no recognisable body is not proof of anything.
  return { verdict: "blocked", reason: "empty or unreadable body" };
}

interface AttemptOptions {
  referer?: string;
  /** Skip the Range header (used when the server answered 416). */
  noRange?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function attempt(url: string, options: AttemptOptions): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: IMAGE_ACCEPT,
    "Accept-Language": "en-US,en;q=0.9",
  };
  // The site itself loads photos with `referrerPolicy="no-referrer"`, so the
  // first attempt must not send one either: a CDN that only answers a bare
  // request would otherwise look broken from a Worker and fine in a browser.
  if (options.referer) headers.Referer = options.referer;
  if (!options.noRange) headers.Range = `bytes=0-${SNIFF_BYTES - 1}`;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1000, options.timeoutMs ?? ATTEMPT_TIMEOUT_MS)
  );
  try {
    return await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function errorReason(err: unknown): { verdict: JpegVerdict; reason: string } {
  const message = String((err as Error)?.message || err || "request failed");
  if (/too many subrequests/i.test(message)) {
    return { verdict: "blocked", reason: "subrequest budget exhausted" };
  }
  if (/abort|timed? ?out/i.test(message)) {
    return { verdict: "blocked", reason: "timed out" };
  }
  return { verdict: "blocked", reason: message.slice(0, 90) };
}

/**
 * Probe one URL.
 *
 * Request count, in the order tried:
 *   1. bare GET with a Range header   (what a browser does: no Referer)
 *   2. only when the answer was "blocked": the same GET with the page Referer
 *   3. only on HTTP 416: a plain GET without Range
 *
 * Most URLs stop after one request; a blocked one costs two.
 */
export async function probeJpeg(
  url: string,
  options: {
    referer?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Set false to skip the Referer retry (bulk budget). */
    retryWithReferer?: boolean;
  } = {}
): Promise<JpegProbe> {
  const probe = async (attemptOptions: AttemptOptions, via: string): Promise<JpegProbe> => {
    try {
      const res = await attempt(url, { ...attemptOptions, signal: options.signal, timeoutMs: options.timeoutMs });
      const { verdict, reason } = await classify(res);
      return {
        url,
        verdict,
        reason,
        httpStatus: res.status,
        contentType: typeOf(res) || undefined,
        via,
      };
    } catch (err) {
      const { verdict, reason } = errorReason(err);
      return { url, verdict, reason, via };
    }
  };

  // 1) Bare request, exactly like the visitor's browser.
  const first = await probe({}, "direct");

  if (first.httpStatus === 416) {
    const withoutRange = await probe({ noRange: true }, "range");
    if (withoutRange.verdict !== "blocked") return withoutRange;
  }
  if (first.verdict !== "blocked") return first;

  // 2) A referer-requiring CDN answers a bare request with 403 — try the page.
  const referer = (options.referer || "").trim();
  const canRetry = options.retryWithReferer !== false && /^https?:\/\//i.test(referer);
  if (!canRetry) return first;

  const second = await probe({ referer }, "referer");
  if (second.verdict === "jpeg") return second;
  if (second.verdict === "not-jpeg" || second.verdict === "dead") return second;
  return first;
}

/**
 * Boolean wrapper kept for the many call sites that only need "usable or not".
 *
 * Note what "true" now means: a verified JPEG **or** a URL the checker could not
 * reach. The second case matters — a Worker being blocked by a CDN says nothing
 * about the visitor's browser, and dropping those URLs is what emptied whole
 * profiles.
 */
export async function isJpegResponse(url: string, referer: string): Promise<boolean> {
  const probe = await probeJpeg(url, { referer });
  return probe.verdict === "jpeg" || probe.verdict === "blocked";
}

/** Strict form, for the admin panel and /diag where "proven" matters. */
export async function isVerifiedJpeg(url: string, referer: string): Promise<boolean> {
  return (await probeJpeg(url, { referer })).verdict === "jpeg";
}

// ---------------------------------------------------------------------------
// Parallel probing
// ---------------------------------------------------------------------------
/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Probing used to run one URL at a time; a gallery of ten photos at up to seven
 * seconds each is far past any sensible deadline, so the tail of every list was
 * skipped and reported as rejected.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
  );
  await Promise.all(runners);
  return results;
}
