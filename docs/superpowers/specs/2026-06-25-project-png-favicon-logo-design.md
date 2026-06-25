# Project PNG Favicon/Logo Design

## Goal

Use the user-provided `146419135_p0.png` as the visual source for the project favicon and navigation logo. Do not use the previously generated SVG/vector directions.

## Design

- Crop the original image to a tight square around the character head, ears, and eyes so it remains readable at favicon sizes.
- Export project-local PNG assets under `frontend/public`.
- Use the same cropped image for the browser favicon and the navigation brand mark.
- Keep the original source image unchanged.

## Integration

- Replace the inline SVG favicon in `frontend/index.html` with PNG icon links.
- Replace the text-only navigation mark in `frontend/src/pages/Layout.tsx` with an image.
- Keep existing page layout, routes, and theme behavior unchanged.

## Verification

- Build the frontend.
- Check that the favicon and navigation logo assets exist and are referenced by stable public paths.
