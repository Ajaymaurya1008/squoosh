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

# Privacy

Squoosh does not send your image to a server. All image compression processes locally.

However, Squoosh utilizes Google Analytics to collect the following:

- [Basic visitor data](https://support.google.com/analytics/answer/6004245?ref_topic=2919631).
- The before and after image size value.
- If Squoosh PWA, the type of Squoosh installation.
- If Squoosh PWA, the installation time and date.

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
