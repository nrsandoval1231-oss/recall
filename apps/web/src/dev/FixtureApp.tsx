import { useMemo } from "react";
import { MemorySurface } from "../surface/MemorySurface";
import { createFixtureApi } from "./fixture";
export function FixtureApp() {
  const world = useMemo(
    () =>
      createFixtureApi(
        new URLSearchParams(window.location.search).get("scenario") ?? "",
      ),
    [],
  );
  return (
    <MemorySurface
      {...world}
      synthetic
      settingsPanel={
        <p>
          This fictional world uses only in-memory contracts and local synthetic
          artifacts. Capture, export, authentication, and production writes are
          unavailable here. Reloading resets corrections.
        </p>
      }
    />
  );
}
