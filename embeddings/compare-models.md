# Compare actual OpenL3 and Microsoft CLAP outputs

See [the measured 2026-10-09 run](comparison-2026-10-09.md) for results from 46
tracks in the local collection.

`compare_models.py` runs a read-only retrieval experiment using the existing Sole
worker and Music Assistant container images. It launches separate disposable
containers, mounts the music read-only during excerpt preparation, and makes no
database writes or playback requests.

```sh
python3 embeddings/compare_models.py run \
  --output /tmp/opencode/sole-model-comparison --text
```

Defaults: two seeded, distinct-title tracks from each eligible artist in a fixed
24-artist list; three seven-second excerpts per track, starting at 45 seconds,
the midpoint of the remaining usable span, and seven seconds before the end.
Only tracks at least 60 seconds long are eligible. Missing artists are recorded.
Both models consume identical hashed mono 44.1 kHz WAVs. OpenL3 resamples to its
48 kHz input rate. This deliberately compares matched audio rather than the
different default sampling recipes of the two applications.

- OpenL3: music/mel256/512, Kapre frontend, 0.5-second hop, mean frame pooling.
- CLAP: the installed MA image's vendored Microsoft CLAP 2023 implementation,
  1,024-dimensional output; optional matching text encoder with `--text`.
- Both average the three window embeddings and rank by cosine similarity.
- A sample-centered OpenL3 variant shows sensitivity to centering; it does not
  reproduce Sole's whole-library mean or its recommendation reranking.

Override container names with `--music-container`, `--worker-container`, and
`--ma-container`. Choose artists with `--artists 'Radiohead' 'Sade' 'Avicii'`;
change sample size with `--per-artist`. Use a new output directory when changing
selection, model settings, or text mode: completed stages are reused on rerun.
The installed MA image must contain Sonic Analysis and its runtime dependencies.
First use downloads CLAP weights and, with `--text`, the GPT-2 text encoder into
the experiment's own `model-cache`; internet access and several GB free are needed.

Outputs include `manifest.json` (source names, timestamps, excerpt hashes), model
metadata (versions, dimensions, timing, CLAP weight hash), `runtime.json` (exact
image IDs and CPU details), window/track vectors in NPZ, cosine matrices in NPY,
`results.json`, and `report.md`. Audio excerpts and model caches stay outside the
repository. Reports include top neighbours for every seed, pairwise rank
correlation, top-1 agreement, top-5 overlap, and optional text-search matches.

Agreement is not accuracy. A small artist-stratified sample cannot establish
whole-library recommendation quality; inspect the returned songs or add human
relevance judgments. Cosine magnitudes are not comparable across model spaces.
Timing excludes common decoding and separates model load/download from inference.

Metric sanity checks can run in the worker image:

```sh
docker run --rm -v "$PWD/embeddings:/experiment:ro" --entrypoint python \
  ghcr.io/poesterlin/sole-embeddings:latest \
  -m unittest discover -s /experiment/tests -p test_compare_models.py -v
```
