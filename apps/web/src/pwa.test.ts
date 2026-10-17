import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("installable web app", () => {
  it("publishes a standalone MONOLITH manifest with canonical icons", () => {
    const manifest = JSON.parse(read("../public/manifest.webmanifest")) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe("MONOLITH");
    expect(manifest.short_name).toBe("MONOLITH");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(read(`../public${icon.src}`)).toBeTruthy();
    }
  });

  it("uses the supplied MONOLITH M mark and bundled heading font", () => {
    const mark = read("../../desktop/public/brand/monolith-mark.svg");
    const tokens = read("../../../packages/design-tokens/src/brand.css");
    expect(mark).toContain("L100 91");
    expect(mark).not.toMatch(/<circle\b/i);
    expect(tokens).toContain('font-family: Sora;');
    expect(tokens).toContain("Sora-Variable.ttf");
  });

  it("declares the Home Screen viewport, safe area, and Apple web app metadata", () => {
    const html = read("../index.html");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("apple-mobile-web-app-capable");
    expect(html).toContain("apple-touch-icon");
    expect(html).toContain('content="MONOLITH"');
    const css = read("./styles.css");
    expect(css).toContain("safe-area-inset-top");
    expect(css).toContain("safe-area-inset-bottom");
  });

  it("keeps the service worker off private API and enrollment traffic", () => {
    const worker = read("../public/sw.js");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(worker).toContain("networkFirst");
    expect(worker.toLowerCase()).not.toContain("generative");
    const entry = read("./main.tsx");
    expect(entry).toContain('navigator.serviceWorker.register("/sw.js")');
  });
});
