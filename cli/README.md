# Squoosh batch CLI

Compress a folder of images without opening the web app. It runs the same
WebAssembly codecs as batch mode, with the same default settings, so the same
image and options give you the same file.

```sh
node cli/index.js photos/
```

No install and no dependencies — it uses the codecs already in this repo and
nothing from npm. Node 18.3 or newer.

## Usage

```
squoosh-batch [options] <files or directories...>

  -f, --format <name>    Output format, repeatable or comma-separated.
                         mozJPEG, webP, avif, jxl, oxiPNG, wp2, qoi
                         (default: mozJPEG)
  -o, --out-dir <dir>    Where to write results (default: ./squooshed)
  -q, --quality <n>      Quality for lossy formats, overriding the default
      --max-width <n>    Shrink images to fit this width
      --max-height <n>   Shrink images to fit this height
  -c, --concurrency <n>  Images to work on at once (default: CPUs - 1, max 4)
      --overwrite        Replace existing output files
  -h, --help             Show this
```

Examples:

```sh
# Everything in a folder, to JPEG
node cli/index.js photos/

# Two formats at once, at quality 60
node cli/index.js -f webP -f avif -q 60 -o out photos/*.jpg

# Shrink oversized images on the way through
node cli/index.js -f webP --max-width 2000 hero.png
```

Directories are scanned one level deep for images. Formats are named exactly as
the web app names them, and matched case-insensitively, so `-f webp` and
`-f webP` both work. With more than one format, results go into a folder per
format. Existing files are left alone unless you pass `--overwrite`.

Images are decoded and encoded across a pool of worker threads, one image per
worker, which is the same arrangement batch mode uses in the browser.

## Does it match the web app?

For most formats, exactly — same bytes, same checksum. Verified by compressing
the same images both ways and comparing SHA-256:

| Format  | Matches the web app |                                             |
| ------- | ------------------- | ------------------------------------------- |
| MozJPEG | Yes                 | byte-identical                              |
| WebP    | Yes                 | byte-identical                              |
| OxiPNG  | Yes                 | byte-identical                              |
| WebP v2 | Yes                 | byte-identical                              |
| QOI     | Yes                 | byte-identical                              |
| AVIF    | No                  | a few tenths of a percent different in size |
| JPEG XL | No                  | a few tenths of a percent different in size |

AVIF and JPEG XL differ because the browser runs **multi-threaded** builds of
those two codecs, and only single-threaded builds can load under Node. The
number of threads changes how those encoders divide the work, which changes the
bytes they emit. Quality is equivalent; the files just aren't identical.

Two formats are missing here: **Browser JPEG** and **Browser PNG**. Those encode
through a `<canvas>`, which only exists in a browser. Use MozJPEG and OxiPNG,
which are better anyway.

### Reading images

The web app asks the browser to decode JPEG and PNG, because browsers already
know how. Without a browser this uses the same wasm decoders Squoosh ships for
its other formats. The two agree byte-for-byte on JPEG and on PNGs without
transparency.

PNGs with **semi-transparent** pixels are the one exception. A browser stores
transparent images with premultiplied alpha and loses a little precision
converting back, so a pixel the wasm decoder reads as `[136,128,119]` comes back
from a canvas as `[136,127,119]`. That difference is invisible, but it's enough
to change the compressed bytes. The CLI's reading is the more accurate of the
two.

## Keeping the defaults in step

`lib/defaults.js` copies the default options out of the web app's encoder
metadata (`src/features/encoders/*/shared/meta.ts`), and each block names the
file it came from. If you change a default in the web app, change it here too,
or the two will quietly stop producing the same files.
