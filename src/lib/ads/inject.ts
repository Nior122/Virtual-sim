// ---------------------------------------------------------------------------
// Putting a pasted network snippet into the page.
//
// Kept out of the React component so it can be exercised against a real DOM in
// a test: "I pasted the code and nothing happened" is the single most common
// advert bug, and it has exactly two causes worth checking for —
//
//   1. the snippet was inserted with `innerHTML`, which creates a `<script>`
//      that is *never executed*;
//   2. the snippet uses `document.write`, which after load replaces the whole
//      document (the site disappears, or the advert does).
//
// `mountSnippet` handles both: script tags are re-created from scratch so the
// browser runs them, and `document.write` snippets are confined to an iframe.
// ---------------------------------------------------------------------------

export interface MountResult {
  /** Nodes that were put into the host. */
  nodes: number;
  /** `<script>` elements re-created (and therefore executed). */
  scripts: number;
  /** True when the snippet was mounted in a sandboxed frame instead. */
  framed: boolean;
}

/** Copy a parsed node into the live document, re-creating `<script>` tags. */
export function revive(node: Node, doc: Document): Node {
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "SCRIPT") {
    const original = node as HTMLScriptElement;
    const script = doc.createElement("script");
    for (const attribute of Array.from(original.attributes)) {
      script.setAttribute(attribute.name, attribute.value);
    }
    // Keep source order: an inline call must run after the library it needs.
    if (script.src && !original.hasAttribute("async")) script.async = false;
    script.text = original.textContent || "";
    return script;
  }

  const copy = doc.importNode(node, false);
  const target = copy as unknown as ParentNode;
  childNodesOf(node).forEach((child) => {
    target.appendChild(revive(child, doc));
  });
  return copy;
}

export function childNodesOf(node: Node): Node[] {
  const list: Node[] = [];
  node.childNodes.forEach((child) => list.push(child));
  return list;
}

/** Sandboxed frame for snippets that would otherwise `document.write` the page away. */
export function buildFrame(code: string, height: number): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.title = "Advertisement";
  frame.setAttribute("scrolling", "no");
  // Pop-ups and forms work (that is what a pop-under is); navigating the page
  // that hosts the frame does not.
  frame.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
  );
  frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  frame.style.cssText = `display:block;border:0;width:100%;height:${height}px;overflow:hidden;background:transparent;`;
  frame.srcdoc =
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>" +
    `</head><body>${code}</body></html>`;

  // srcdoc frames are same-origin, so the ad's real height can be measured and
  // the frame grown instead of clipping the creative.
  frame.addEventListener("load", () => {
    const measure = () => {
      try {
        const body = frame.contentDocument?.body;
        if (!body) return;
        const next = Math.max(body.scrollHeight, body.offsetHeight);
        if (next > 20 && next < 700 && Math.abs(next - height) > 8) {
          frame.style.height = `${next}px`;
        }
      } catch {
        /* the frame navigated away: keep the default height */
      }
    };
    measure();
    window.setTimeout(measure, 1500);
  });

  return frame;
}

/**
 * Split a pasted snippet into top-level nodes.
 *
 * `DOMParser.parseFromString(code, "text/html").body` is *not* good enough: the
 * HTML parser sends any leading `<script>` to `<head>`, so it never appears in
 * `body`. A tag that is just `<script src="//network/tag.js"></script>` — which
 * is what most networks hand out — would parse to an empty body and be dropped
 * without a trace. A `<template>` parses the whole string into one flat
 * fragment, so nothing is silently moved out of reach.
 */
export function parseFragment(code: string): Node[] {
  const tpl = document.createElement("template");
  tpl.innerHTML = code;
  const nodes = childNodesOf(tpl.content);
  if (nodes.length) return nodes;

  // Fallback for snippets wrapped in `<html>`/`<head>`/`<body>`: keep the
  // document order by taking head first, then body.
  const parsed = new DOMParser().parseFromString(code, "text/html");
  return [...childNodesOf(parsed.head), ...childNodesOf(parsed.body)];
}

/** Does this snippet need the sandboxed frame? */
export function needsFrame(code: string): boolean {
  return /document\s*\.\s*write\s*\(/i.test(code);
}

/**
 * Put a snippet into `host`.
 *
 * Returns what happened, so the admin panel can say "2 scripts injected" rather
 * than leaving the owner guessing. An empty or whitespace-only snippet clears
 * the host and reports zero, never an error.
 */
export function mountSnippet(
  host: HTMLElement,
  code: string,
  frameHeight = 110
): MountResult {
  host.replaceChildren();
  const trimmed = (code || "").trim();
  if (!trimmed) return { nodes: 0, scripts: 0, framed: false };

  if (needsFrame(trimmed)) {
    host.appendChild(buildFrame(trimmed, frameHeight));
    return { nodes: 1, scripts: 0, framed: true };
  }

  const nodes = parseFragment(trimmed);
  let scripts = 0;
  for (const node of nodes) {
    const revived = revive(node, document);
    if (revived.nodeType === Node.ELEMENT_NODE && (revived as Element).tagName === "SCRIPT") {
      scripts += 1;
    }
    host.appendChild(revived);
  }
  return { nodes: nodes.length, scripts, framed: false };
}
