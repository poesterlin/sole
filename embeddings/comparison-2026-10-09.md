# Measured OpenL3 vs Microsoft CLAP comparison — 2026-10-09

Executed with [compare_models.py](compare_models.py):

```sh
python3 embeddings/compare_models.py run \
  --output /tmp/opencode/sole-model-comparison --text
```

## Method

- 46 tracks from 23 artists, two distinct-title tracks per artist, seed 20261009.
  The default AC/DC folder was absent; the manifest records that omission.
- Three shared seven-second mono excerpts per track: 45 seconds, midpoint of
  the remaining usable range, and seven seconds before the end. All 138 decoded
  WAV hashes were verified after inference.
- OpenL3 music/mel256/512, Kapre frontend, 0.5s hop, mean frame pooling.
- Microsoft CLAP 2023, 1024 dimensions, using MA 2.11.0b0's vendored implementation.
- Mean of each model's three window vectors; cosine retrieval against the other
  45 tracks. No metadata bonuses, likes, skips, or recommendation reranking.
- AMD Ryzen 7 255, CPU only, four threads, sequential disposable containers.

## Measured agreement

| Representation against uncentered CLAP | Pairwise Spearman | Same first neighbour | Mean top-5 overlap |
|---|---:|---:|---:|
| Raw OpenL3 | 0.618 | 15.2% (7/46) | 42.6% (2.13/5) |
| Sample-centered OpenL3 | 0.387 | 19.6% (9/46) | 40.0% (2.00/5) |

The models share broad structure but often choose different nearest songs.
Sample-centering uses these 46 tracks, not Sole's whole-library mean. It is a
sensitivity check, not a reproduction of production recommendations.

## Actual top-three neighbours

| Seed | Raw OpenL3 | Sample-centered OpenL3 | CLAP |
|---|---|---|---|
| Adele — Remedy | Adele — Hello; Radiohead — Life In a Glasshouse; Dolly Parton — Not For Me | Maria Callas — Act 3: Marcello. Finalmente; Adele — Hello; Dolly Parton — Not For Me | Adele — Hello; Radiohead — Life In a Glasshouse; Billie Eilish — Your Power |
| Linkin Park — Numb | Avicii — Ain’t a Thing; Linkin Park — Breaking The Habit; Radiohead — Burn the Witch | Foo Fighters — Amen, Caveman; Radiohead — Burn the Witch; Linkin Park — Breaking The Habit | Linkin Park — Breaking The Habit; Radiohead — Burn the Witch; Foo Fighters — Unconditional |
| Jose González — Deadweight On Velveteen | Jose González — Stay In The Shade; Sufjan Stevens — Wordsworth’s Ridge; Dolly Parton — Not For Me | Jose González — Stay In The Shade; Sufjan Stevens — Wordsworth’s Ridge; Dolly Parton — Not For Me | Jose González — Stay In The Shade; Sufjan Stevens — Wordsworth’s Ridge; Dolly Parton — Not For Me |
| Massive Attack — Angel | Massive Attack — Babel; Daft Punk — Something About Us; Billie Eilish — Therefore I Am | Daft Punk — Something About Us; Massive Attack — Babel; Billie Eilish — Therefore I Am | Kendrick Lamar — A.D.H.D; Linkin Park — Numb; Avicii — Ain’t a Thing |
| Maria Callas — Act 3: Marcello. Finalmente | Adele — Hello; Adele — Remedy; Frank Sinatra — Mood Indigo | Adele — Hello; Frank Sinatra — Mood Indigo; Adele — Remedy | Maria Callas — Act 1: Al Quatiere latin; Frank Sinatra — Mood Indigo; Bon Iver — 33 GOD |

Some titles are shortened here for readability. Exact metadata titles, scores,
and all 46 seeds are in the generated report.

CLAP's rock and opera neighbours look more category-consistent in these examples.
OpenL3's Massive Attack neighbours look like a plausible alternative to CLAP's.
The acoustic José González example agrees across all representations. These are
qualitative observations from returned identities, not blinded listening scores.

Raw OpenL3 top neighbours frequently score around 0.99. High cosine values do
not mean near-identical songs; the representation has a strong common component.
Centering changes retrieval substantially. Cosine magnitudes should not be
compared directly between OpenL3 and CLAP.

## CLAP text-search outputs

| Prompt | First three results |
|---|---|
| Loud heavy rock music with distorted guitars and drums | Foo Fighters — Amen, Caveman; Foo Fighters — Unconditional; Radiohead — Burn the Witch |
| Hip hop music with rapping over a beat | Kendrick Lamar — A.D.H.D; Eminem — Encore / (Curtains); Kendrick Lamar — peekaboo |
| Classical opera music with an operatic singing voice and orchestra | Maria Callas — Act 3: Marcello. Finalmente; Maria Callas — Act 1: Al Quatiere latin; Frank Sinatra — Mood Indigo |
| Electronic dance music with synthesizers and a strong beat | Avicii — City Lights; Radiohead — Burn the Witch; Massive Attack — Angel |
| Country music with acoustic guitars and singing | Dolly Parton — Down From Dover; Sade — Bring Me Home; Jose González — Stay In The Shade |

Text retrieval clearly works, but remains fuzzy: the dance and country prompts
also retrieve songs outside those genre labels. Results are restricted to this
small sample. Text/audio cosine is not a calibrated probability.

## Timing and sampling sensitivity

| Model | Median inference per track (three excerpts) | Total inference for 46 tracks | Initial load/download |
|---|---:|---:|---:|
| OpenL3 | 2.12s | 97.75s | 3.53s |
| CLAP | 0.24s | 11.37s | 115.13s |

CLAP inference was approximately nine times faster in this configuration.
OpenL3 computes multiple overlapping one-second frames per excerpt; CLAP uses
one seven-second model input. These are matched audio, not matched operation
counts. CLAP's initial loading includes downloading weights and the text encoder;
OpenL3 weights were already in its image. Decode time is excluded for both.
This does not establish full-library throughput under the applications' defaults.

Using only the first excerpt instead of the pooled three preserved 63.9% of
OpenL3's top-five neighbours and 67.4% of CLAP's. Multiple excerpts matter for both.

## Artifacts and reproducibility

The full local experiment is `/tmp/opencode/sole-model-comparison/`:

- `report.md`, `results.json`: all neighbours, cosine scores, eight text prompts,
  agreement metrics, timing, and sampling sensitivity.
- `manifest.json`: exact selected files, metadata, clip offsets, and SHA-256 hashes.
- `openl3.npz`, `clap.npz`, `clap-text.npy`: actual window, track, and text vectors.
- `*-cosine.npy`: pairwise similarity matrices.
- `*-metadata.json`, `runtime.json`: model/software versions, timings, image IDs,
  CPU details, and model checkpoint hash.

Image IDs:

```text
OpenL3: sha256:36b23c96887cffe928b4442aef7f35f791b9712c1da7975bc4d19f809190a29c
MA:     sha256:f5d07098312ec3668567ccd3d43784b1492bdeda291d316ffe4b53ddda30584b
CLAP weights SHA-256:
2cef4016d47d00eb28d153d522f397222057f95000e9bad6b9583c631284a1e6
```

Metric sanity tests passed, including cosine geometry preserved under scaling
and dimensional padding, exclusion of self-neighbours, and rejection of
mismatched track ordering. Similarity matrices were checked for symmetry and
unit diagonals. Audio and model caches remain outside the repository.

This experiment establishes differences in actual outputs, not a universal
quality winner. Whole-library centering, longer sampling, human judgments, and
Sole's recommendation controls could change the practical ranking.
