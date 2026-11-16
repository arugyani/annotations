# Changelog

## 1.0.10 — November 15, 2026

- Highlight rendered equations and add notes in Live Preview.
- Keep math highlights aligned with equation lines when scrolling.
- Preview math selections without switching equations to source text.

## 1.0.9 — November 15, 2026

- Add a feathered highlight sweep, softer selection pill, and smooth color selection feedback.
- Honor reduced motion and prevent stale reveals after immediate or batched undo.
- Refresh the benchmark table.

## 1.0.8 — November 15, 2026

- Use Obsidian DOM helpers for annotation controls while preserving pop-out document ownership.
- Replace CSS `!important` overrides with scoped selectors.
- Preserve reduced-motion and high-contrast support.
- Publish only the three files supported by Obsidian.
- Add an optional attestation check on a standard public-repository runner.

## 1.0.7 — November 15, 2026

- Release Annotations with immediate highlighting, optional notes, stable selection motion, and a compact sidebar.
- Keep annotation metadata readable in Markdown and hidden in rendered notes.
- Harden startup, render cleanup, pop-out controls, and synced settings validation.
- Use the unique `annotations` plugin ID; existing Markdown annotations remain compatible.
- Provide locally validated release assets, checksums, and a synthetic test vault without requiring GitHub Actions.

## 1.0.1 — November 13, 2026

- Fold valid stored comment data in Source mode and Live Preview. A compact footer control and command explicitly reveal it; inspecting/folding changes no stored bytes.
- Show a floating color pill when text is selected. A color click saves a highlight immediately, with an optional note added inline.
- Keep the same annotation when recoloring or adding a note. Highlight-only annotations offer Add a note in the sidebar.
- Support keyboard entry/save, touch-sized controls, cancellation, and conservative rejection if the source or annotation changes while composing.
- Protect the folded storage boundary during navigation and forward-delete while keeping raw inspection and external edits available.
- Retain the existing v1 Markdown format. No note migration is required.

## 1.0.0 — November 12, 2026

Initial plugin, followed by interface and performance improvements. Source, installation packages, dedicated synthetic vault, format documentation, and measured performance reports are included in this repository.
