# DM Sans font provenance

HAC-133 names DM Sans as the application font. Akshar requested completion of its
`next/font` requirement on November 14, 2026. The app self-hosts this unmodified
normal-style variable font; no hosted font request or new package is needed.

- Source: [Google Fonts DM Sans directory](https://github.com/google/fonts/tree/5b35b7208dd4100571326fdf37f030b32a524232/ofl/dmsans).
- Pinned revision: `5b35b7208dd4100571326fdf37f030b32a524232`.
- Original filename: `DMSans[opsz,wght].ttf`; stored as `DMSans-Variable.ttf`.
- Size: 240,164 bytes. Weight axis: 100–1000. Optical-size axis: 9–40.
- SHA-256: `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d`.
- License: [SIL Open Font License 1.1](OFL.txt), with all upstream wording retained;
  line endings and trailing whitespace are normalized for the repository.
- Copyright: The DM Sans Project Authors; upstream project
  [googlefonts/dm-fonts](https://github.com/googlefonts/dm-fonts).

`app/layout.tsx` uses `next/font/local` with `display: swap`, the full weight range
and `--font-bizbox-sans`. The generated root variable feeds the shared Tailwind
`font-sans` token in `app/workspace.css`. Next.js emits a preloaded same-origin
asset and a metric-adjusted fallback; the existing system stack is retained.

Only the normal variable face is bundled. Browser-synthesized italics remain
available; add the companion upstream italic asset if the product later
needs designed italic typography. The static landing document is a separate surface.

When updating, pin a new upstream revision, verify the Git blob and SHA-256,
retain the applicable license, then run the typography browser test in Chromium
and WebKit plus the repository checks. Never copy a locally installed proprietary
system font into this directory.
