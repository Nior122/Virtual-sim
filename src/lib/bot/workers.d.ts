// Minimal ambient types for the Cloudflare Workers/Pages Functions runtime.
// Kept local so the bot modules type-check under the repo's existing tsconfig
// (DOM + ES2022 libs) without requiring @cloudflare/workers-types.

declare interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
