# Recall web visual direction

Status: implemented interactive direction. The web client uses adaptive Ask, Explore, and Capture modes while preserving the source and capture trust boundaries in the canonical product documents.

## Thesis

Recall is a quiet instrument in deep space: a question, a source, and the distance between them. Glass boards make memory feel spatial without turning sources into decoration.

## Visual world

The canvas is overwhelmingly space black (#030408) with a sparse, low contrast star field. Boards use neutral smoked glass, silver rims, soft inset highlights, and restrained electric blue (#1857f5) actions. There are no paper textures or synthetic memory records in the production client. Original imagery appears only after the user opens a real source and passes the integrity check.

Typography uses Segoe UI and system sans-serif, without external font requests. Primary text is #f2f4fa and secondary text #bdc4d3. Color is never the only status signal: each status is named in text.

## Adaptive interaction

- **Ask** is the default. A single composer owns the first viewport. Editing a question clears the visible answer and invalidates an older request so late results cannot replace the current question.
- **Answer** replaces the welcome boards with adjacent supporting sources, a focused response, and evidence. Selecting a citation updates its excerpt and closes the prior original. Focus answer expands the response; Show sources restores the source list. Original access remains explicit.
- **Explore** turns authorized captures into source boards. Selecting a board opens its original on demand, shows the real page ordinal, and reports `Ready`, `Needs review`, `Reading`, `Needs retry`, `Incomplete`, or `Uploaded` from server state.
- **Capture** focuses the durable browser draft flow. The selected file and context survive mode switches, the original is saved locally before upload, and pending drafts remain recoverable until the user explicitly retries or removes them.
- **Settings** opens from the header in any mode. AI reading remains an explicit consent action and is never enabled by navigation or display.

The dock is keyboard accessible and responsive: desktop uses a horizontal glass surface, while phone stacks content and keeps mode controls usable without relying on hover or motion. Reduced motion removes reveal transitions while preserving all content.

## Trust and fidelity

Every answer citation stays tied to its source ID and page ordinal. Original bytes must match the server hash; capture originals must also match the capture's declared hash. Model statuses and limitations remain legible. Local-only, uploaded, processing, failed, and review states are never collapsed into an optimistic success label. Capture supports the existing single-image save flow; source viewing supports stored page ordinals. This UI does not add multi-page capture or graph exploration.

## Palette exploration

Emerald (`#35D99A`, mint `#A7F3D0`, near-black `#030806`, dark action text `#052012`) is the latest visual preview. Jade and Fern alternatives and all mockups are preserved in [the design archive](../../docs/design/2026-10-glass-ui/README.md). The implemented CSS remains blue; palette exploration is not a shipped palette change.

## Implementation acceptance

- Ask is dominant on initial desktop and phone viewports.
- Explore and Capture are explicit user actions with no hidden backend contract.
- No synthetic result is inserted into the signed-in library or empty state.
- Late Ask and source-viewer responses cannot update an unmounted or replaced surface.
- Visible focus, readable contrast, mobile stacking, and `prefers-reduced-motion` are supported.
