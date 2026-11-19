// Tiny GA4 wrapper. gtag is only loaded by index.html on the live web domains
// (never in the Tauri desktop app or on localhost), so every call here is a
// silent no-op elsewhere and can never throw.
type Gtag = (...args: unknown[]) => void;

export function track(event: string, params: Record<string, unknown> = {}): void {
  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === "function") gtag("event", event, params);
  } catch {
    /* analytics must never break the app */
  }
}
