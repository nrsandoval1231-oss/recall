import process from "node:process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../apps/web/dist");
const pwaIcons = new Set([
  resolve(root, "icons/icon-192.png"),
  resolve(root, "icons/icon-512.png"),
  resolve(root, "icons/icon-maskable-512.png"),
  resolve(root, "icons/apple-touch-icon.png"),
]);
const forbidden =
  /Brooks Campus|Mara Chen|Alder Works|synthetic-fixture|createFixtureApi|september-email|july-notebook|august-site/;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (
      (/\.(png|jpe?g)$/.test(entry.name) && !pwaIcons.has(path)) ||
      forbidden.test(await readFile(path, "utf8"))
    )
      throw new Error(
        `Development fixture leaked into production output: ${path}`,
      );
  }
}
await inspect(root);
process.stdout.write(
  "Production fixture isolation: passed (no fixture code, names, or original artifacts).\n",
);
