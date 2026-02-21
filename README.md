# Compositor — Metal Halftone

A browser-based compositing tool that converts images into linear halftone patterns and lets you mask between the original and halftone versions using shapes (rectangles, circles, triangles).

## Features

- **Linear halftone generation** — adjustable frequency, angle, thickness, and line color
- **Shape masks** — add, move, resize, and delete rectangle, circle, and triangle masks
- **Composition modes** — choose whether masks reveal the halftone or the original image
- **Background control** — transparent or solid color backgrounds
- **Export** — download composites as PNG at 1×–4× resolution
- **Zoom** — keyboard shortcuts (`+`, `-`, `0`) and on-screen controls

## Development

```bash
npm install
npm run dev
```

## Deployment

Configured for Netlify with `@netlify/plugin-nextjs`. Connect the repo and deploy — no extra setup needed.
