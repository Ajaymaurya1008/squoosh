# [Squoosh]!

[Squoosh] is an image compression web app that reduces image sizes through numerous formats.

# Batch compression

As well as the single-image editor, Squoosh has a batch mode at `/batch` for
compressing many images at once:

- **Many images at a time.** Drop several images anywhere in the app, pick
  several from the file picker, or use **Compress many at once** on the home
  page. Images are decoded and encoded in parallel across a pool of workers.
- **Several formats at a time.** Select any number of output formats and every
  image is encoded to each one, with per-image and per-format size savings shown
  as they finish. Each format keeps its own quality settings.
- **Remembered settings.** The formats you pick, their options, and the resize
  settings are stored in `localStorage`, so they're selected by default the next
  time you visit. The last format you picked also becomes the default in the
  single-image editor.
- **Optional downscaling.** Shrink every image to fit inside a maximum width and
  height, preserving aspect ratio.
- **Download everything.** Grab a single result, or download the whole batch as
  a zip (one folder per format when several are selected).

Like the rest of Squoosh, all of this runs locally — no image is uploaded.

# Command line

The same batch compression is available without a browser:

```sh
node cli/index.js -f webP -q 60 -o out photos/
```

It runs the same WebAssembly codecs with the same defaults, so most formats
come out byte-identical to the web app. See [cli/README.md](/cli/README.md) for
the options and for exactly which formats match.

# Privacy

Squoosh does not send your image to a server. All image compression processes locally.

This fork has no analytics at all. Upstream Squoosh reports basic visitor data,
image sizes and PWA install events to Google Analytics; that code has been
removed here, so nothing is collected and no third-party scripts are loaded.

# Developing

To develop for Squoosh:

1. Clone the repository
1. To install node packages, run:
   ```sh
   npm install
   ```
1. Then build the app by running:
   ```sh
   npm run build
   ```
1. After building, start the development server by running:
   ```sh
   npm run dev
   ```

# Deploying

The build is a static site in `build/`, but it needs two response headers
(`Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin`) for the multi-threaded WebAssembly
codecs to run, plus redirects for the `/editor` and `/batch` routes.

- **Netlify** and similar hosts read the generated `_headers` and `_redirects`
  files in `build/`.
- **Vercel** ignores those files, so `vercel.json` in the repo root declares the
  same headers and redirects. Import the repo and the defaults apply — build
  command `npm run build`, output directory `build`.

If the deployed app logs `crossOriginIsolated === false` in the console, the
headers aren't reaching the browser and the threaded codecs will fall back or
fail.

# Contributing

Squoosh is an open-source project that appreciates all community involvement. To contribute to the project, follow the [contribute guide](/CONTRIBUTING.md).

[squoosh]: https://squoosh.app
