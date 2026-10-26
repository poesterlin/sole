#!/usr/bin/env python3
"""Read-only, reproducible OpenL3 vs MA's vendored Microsoft CLAP comparison.

Use `run` on the host; model stages execute in disposable existing-image containers.
No database credentials or service API calls are needed. See compare-models.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import time

ARTISTS = [
    "AC/DC", "Adele", "Agnes Obel", "Amy Winehouse", "Avicii", "Beach House",
    "Billie Eilish", "Bon Iver", "Daft Punk", "Dolly Parton", "Eminem",
    "Fleetwood Mac", "Foo Fighters", "Frank Sinatra", "Jose González",
    "Kendrick Lamar", "Linkin Park", "Massive Attack", "Maria Callas",
    "Queen", "Radiohead", "Sade", "Sufjan Stevens", "The Weeknd",
]
PROMPTS = [
    "Soft acoustic folk music with a gentle singing voice.",
    "Loud heavy rock music with distorted guitars and drums.",
    "Electronic dance music with synthesizers and a strong beat.",
    "Hip hop music with rapping over a beat.",
    "Soulful jazz music with a smooth singing voice.",
    "Classical opera music with an operatic singing voice and orchestra.",
    "Dreamy atmospheric music with soft vocals.",
    "Country music with acoustic guitars and singing.",
]


def command(args):
    return subprocess.check_output(args, text=True).strip()


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def prepare(args):
    """Select seeded tracks per artist and decode once for both models."""
    import soundfile as sf
    root, out = Path(args.music), Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    tracks = []
    missing = []
    for artist in args.artists or ARTISTS:
        folder = root / artist
        files = sorted(p for p in folder.rglob("*") if p.suffix.lower() in
                       {".mp3", ".flac", ".m4a", ".ogg", ".wav", ".opus"})
        rng.shuffle(files)
        selected_titles = set()
        count = 0
        for path in files:
            meta = json.loads(command(["ffprobe", "-v", "error", "-show_format",
                                       "-of", "json", str(path)]))["format"]
            duration = float(meta.get("duration", 0))
            tags = {k.lower(): v for k, v in meta.get("tags", {}).items()}
            title = tags.get("title", path.stem)
            if duration < 60 or title.casefold() in selected_titles:
                continue
            selected_titles.add(title.casefold())
            track_id = f"t{len(tracks):03}"
            # Balanced-like sampling: 45s, midpoint of usable range, final 7s.
            starts = [45.0, (45.0 + duration - 7.0) / 2, duration - 7.0]
            clips = []
            for i, start in enumerate(starts):
                name = f"{track_id}-{i}.wav"
                subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y",
                                "-ss", str(start), "-i", str(path), "-t", "7",
                                "-ac", "1", "-ar", "44100", "-c:a", "pcm_f32le",
                                str(out / name)], check=True)
                audio, sr = sf.read(out / name)
                if sr != 44100 or len(audio) < 44100 * 6.9:
                    raise ValueError(f"Incomplete excerpt: {path}")
                clips.append({"file": name, "start_seconds": start,
                              "samples": len(audio),
                              "sha256": hashlib.sha256((out / name).read_bytes()).hexdigest()})
            tracks.append({"id": track_id, "artist": artist, "title": title,
                           "album": tags.get("album", path.parent.name),
                           "source": str(path.relative_to(root)),
                           "duration_seconds": duration, "clips": clips})
            print(f"Prepared {artist} — {title}", flush=True)
            count += 1
            if count == args.per_artist:
                break
        if not count:
            missing.append(artist)
    if len(tracks) < 4:
        raise ValueError("Need at least four eligible tracks")
    save(out / "manifest.json", {"seed": args.seed, "tracks": tracks,
                                 "missing_artists": missing, "prompts": PROMPTS,
                                 "sampling": "three 7s mono excerpts at 44.1kHz; 45s, usable midpoint, end"})


def infer(args):
    import importlib.metadata
    import numpy as np
    import soundfile as sf
    out = Path(args.output)
    manifest = json.loads((out / "manifest.json").read_text())
    random.seed(manifest["seed"])
    np.random.seed(manifest["seed"])
    start = time.perf_counter()
    metadata = {"model": args.model, "threads": args.threads}
    if args.model == "openl3":
        import tensorflow as tf
        tf.config.threading.set_intra_op_parallelism_threads(args.threads)
        tf.config.threading.set_inter_op_parallelism_threads(1)
        tf.random.set_seed(manifest["seed"])
        import openl3
        import soxr
        model = openl3.models.load_audio_embedding_model("mel256", "music", 512, frontend="kapre")
        metadata.update(checkpoint="music/mel256/512", hop_seconds=0.5,
                        packages={p: importlib.metadata.version(p) for p in ["openl3", "tensorflow", "soxr"]})

        def embed(audio, sr):
            audio = soxr.resample(audio, sr, 48000).astype(np.float32)
            frames, _ = openl3.get_audio_embedding(audio, 48000, model=model,
                                                  embedding_size=512, hop_size=0.5,
                                                  batch_size=64, verbose=0)
            return frames.mean(axis=0)
    else:
        import torch
        torch.set_num_threads(args.threads)
        torch.set_num_interop_threads(1)
        torch.manual_seed(manifest["seed"])
        from music_assistant.providers.sonic_analysis.vendored_clap import CLAP
        model = CLAP(version="2023", use_cuda=False, text_enabled=args.text)
        metadata.update(checkpoint="microsoft/msclap/CLAP_weights_2023.pth",
                        weights_sha256=hashlib.sha256(Path(model.model_fp).read_bytes()).hexdigest(),
                        packages={p: importlib.metadata.version(p) for p in ["torch", "music-assistant"]})

        def embed(audio, sr):
            with torch.inference_mode():
                return model.get_audio_embeddings_from_tensor(
                    [torch.from_numpy(audio)], sr)[0].cpu().numpy()
    metadata["load_seconds"] = time.perf_counter() - start
    vectors, windows, timings = [], [], []
    for track in manifest["tracks"]:
        track_vectors = []
        elapsed = 0.0
        for clip in track["clips"]:
            path = out / clip["file"]
            if hashlib.sha256(path.read_bytes()).hexdigest() != clip["sha256"]:
                raise ValueError(f"Excerpt hash changed: {path}")
            audio, sr = sf.read(path, dtype="float32")
            t0 = time.perf_counter()
            vector = np.asarray(embed(audio, sr), dtype=np.float32)
            elapsed += time.perf_counter() - t0
            if not np.isfinite(vector).all() or np.linalg.norm(vector) == 0:
                raise ValueError(f"Invalid embedding: {track['id']}")
            track_vectors.append(vector)
        windows.append(track_vectors)
        vectors.append(np.mean(track_vectors, axis=0))
        timings.append(elapsed)
        print(f"{args.model}: {track['artist']} — {track['title']}: {elapsed:.3f}s", flush=True)
    np.savez(out / f"{args.model}.npz", vectors=np.asarray(vectors), windows=np.asarray(windows))
    metadata.update(dimensions=len(vectors[0]), track_ids=[t["id"] for t in manifest["tracks"]],
                    inference_seconds=timings, median_inference_seconds=float(np.median(timings)),
                    total_inference_seconds=sum(timings))
    if args.model == "clap" and args.text:
        with torch.inference_mode():
            text = model.get_text_embeddings(manifest["prompts"]).cpu().numpy()
        np.save(out / "clap-text.npy", text)
    save(out / f"{args.model}-metadata.json", metadata)


def report(args):
    import numpy as np
    out = Path(args.output)
    manifest = json.loads((out / "manifest.json").read_text())
    tracks = manifest["tracks"]
    matrices, neighbours, metadata, stability = {}, {}, {}, {}
    n = len(tracks)
    k = min(5, n - 1)

    def normalize(x):
        return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)

    for name in ["openl3", "clap"]:
        metadata[name] = json.loads((out / f"{name}-metadata.json").read_text())
        if metadata[name]["track_ids"] != [t["id"] for t in tracks]:
            raise ValueError("Track ordering mismatch")
        data = np.load(out / f"{name}.npz")
        vectors = data["vectors"]
        windows = normalize(data["windows"])
        within = np.stack([np.sum(windows[:, a] * windows[:, b], axis=1)
                           for a, b in [(0, 1), (0, 2), (1, 2)]], axis=1)
        first_scores = windows[:, 0] @ normalize(vectors).T
        np.fill_diagonal(first_scores, -np.inf)
        first_neighbours = np.argsort(-first_scores, axis=1)[:, :k]
        variants = {name: vectors}
        if name == "openl3":
            variants["openl3_sample_centered"] = vectors - vectors.mean(axis=0)
        for variant, values in variants.items():
            unit = normalize(values)
            similarities = unit @ unit.T
            matrices[variant] = similarities
            ranked = similarities.copy()
            np.fill_diagonal(ranked, -np.inf)
            neighbours[variant] = np.argsort(-ranked, axis=1)[:, :k]
        stability[name] = {
            "median_within_track_window_cosine": float(np.median(within)),
            "first_window_vs_three_window_top5_overlap": float(np.mean([
                len(set(a) & set(b)) / k for a, b in zip(first_neighbours, neighbours[name])])),
        }

    def rank(values):
        # Average ranks for ties, including float32 quantization ties.
        order = np.argsort(values, kind="stable")
        result = np.empty(len(values), dtype=float)
        pos = 0
        while pos < len(values):
            end = pos + 1
            while end < len(values) and values[order[end]] == values[order[pos]]:
                end += 1
            result[order[pos:end]] = (pos + end - 1) / 2
            pos = end
        return result

    upper = np.triu_indices(n, 1)
    comparisons = {}
    for name in ["openl3", "openl3_sample_centered"]:
        comparisons[name] = {
            "pairwise_spearman": float(np.corrcoef(rank(matrices[name][upper]), rank(matrices["clap"][upper]))[0, 1]),
            "top1_agreement": float(np.mean(neighbours[name][:, 0] == neighbours["clap"][:, 0])),
            "mean_top5_overlap_fraction": float(np.mean([
                len(set(a) & set(b)) / k for a, b in zip(neighbours[name], neighbours["clap"])])),
        }
    result = {"track_count": n, "comparisons_to_clap": comparisons,
              "metadata": metadata, "sampling_stability": stability, "neighbours": {}}

    def label(i):
        return f"{tracks[i]['artist']} — {tracks[i]['title']}"

    lines = ["# OpenL3 vs Microsoft CLAP: measured outputs", "",
             f"Corpus: **{n} tracks**, {len(set(t['artist'] for t in tracks))} artists. Seed {manifest['seed']}.",
             "", manifest["sampling"] + ". Both models receive exactly the same decoded samples.",
             "Track vectors are the mean of three window vectors; cosine search excludes the seed.",
             "", "## Agreement (not recommendation accuracy)", "",
             "| OpenL3 representation vs CLAP | Pairwise Spearman | Same top-1 | Mean top-5 overlap |",
             "|---|---:|---:|---:|"]
    for name, metrics in comparisons.items():
        lines.append(f"| {name} | {metrics['pairwise_spearman']:.3f} | {metrics['top1_agreement']:.1%} | {metrics['mean_top5_overlap_fraction']:.1%} |")
    lines += ["", "Sample-centering subtracts this small corpus's OpenL3 mean. It is a sensitivity check,",
              "not Sole's production centering, which uses the whole library. CLAP is uncentered.",
              "", "## Timing", "", "| Model | Dimensions | Load/download (s) | Median inference per track (s) | Total inference (s) |",
              "|---|---:|---:|---:|---:|"]
    for name, meta in metadata.items():
        lines.append(f"| {name} | {meta['dimensions']} | {meta['load_seconds']:.2f} | {meta['median_inference_seconds']:.2f} | {meta['total_inference_seconds']:.2f} |")
    lines += ["", "Inference includes model-specific resampling but excludes shared decoding, WAV loading,",
              "and model load/download. First-track warm-up is retained. Same CPU thread limit; sequential runs.",
              "", "## Sampling sensitivity", "",
              "| Model | Median cosine between sections of the same song | First-section vs three-section top-5 overlap |",
              "|---|---:|---:|"]
    for name, metrics in stability.items():
        lines.append(f"| {name} | {metrics['median_within_track_window_cosine']:.3f} | {metrics['first_window_vs_three_window_top5_overlap']:.1%} |")
    lines += ["", "Window cosine magnitudes are model-specific; neighbour overlap measures ranking sensitivity.",
              "", "## Actual nearest neighbours", ""]
    for i in range(n):
        lines += [f"### {label(i)}", "", "| Representation | Top three matches (cosine) |", "|---|---|"]
        result["neighbours"][tracks[i]["id"]] = {}
        for name, indices in neighbours.items():
            entries = [{"id": tracks[j]["id"], "label": label(j),
                        "cosine": float(matrices[name][i, j])} for j in indices[i]]
            result["neighbours"][tracks[i]["id"]][name] = entries
            text = "; ".join(f"{e['label']} ({e['cosine']:.3f})" for e in entries[:3])
            lines.append(f"| {name} | {text.replace('|', '/')} |")
        lines.append("")
    if (out / "clap-text.npy").exists():
        text = normalize(np.load(out / "clap-text.npy"))
        audio = normalize(np.load(out / "clap.npz")["vectors"])
        scores = text @ audio.T
        result["text_search"] = {}
        lines += ["## CLAP text search", "", "Cosines are similarities, not calibrated probabilities.", ""]
        for i, prompt in enumerate(manifest["prompts"]):
            picks = np.argsort(-scores[i])[:5]
            entries = [{"label": label(j), "cosine": float(scores[i, j])} for j in picks]
            result["text_search"][prompt] = entries
            lines += [f"**{prompt}**", ""] + [f"- {e['label']} ({e['cosine']:.3f})" for e in entries] + [""]
    lines += ["## Interpretation limits", "", "This is retrieval within a small, artist-stratified sample, not the whole library.",
              "No human relevance labels were supplied, so agreement does not prove either model is better.",
              "Different embedding spaces have different cosine distributions: compare rankings, not score magnitudes.",
              "The matched-excerpt design tests model representations, not Sole's full 90s recipe or MA's Traits engine.",
              "No likes, skips, metadata bonuses, clustering, or recommendation reranking are applied."]
    save(out / "results.json", result)
    (out / "report.md").write_text("\n".join(lines) + "\n")
    for name, matrix in matrices.items():
        np.save(out / f"{name}-cosine.npy", matrix)
    print(json.dumps(comparisons, indent=2))


def run(args):
    script = Path(__file__).resolve()
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    worker_image = command(["docker", "inspect", args.worker_container, "--format", "{{.Image}}"])
    ma_image = command(["docker", "inspect", args.ma_container, "--format", "{{.Image}}"])
    save(out / "runtime.json", {"worker_image": worker_image, "ma_image": ma_image,
                               "threads": args.threads, "platform": command(["uname", "-a"]),
                               "cpu": command(["lscpu"])})

    def stage(image, python, stage_args, music=False):
        cmd = ["docker", "run", "--rm", "--cpus", str(args.threads),
               "-v", f"{script}:/compare.py:ro", "-v", f"{out}:/results",
               "-e", "HF_HOME=/results/model-cache", "-e", "TF_CPP_MIN_LOG_LEVEL=2",
               "-e", "OMP_NUM_THREADS=" + str(args.threads),
               "--entrypoint", python]
        if music:
            cmd += ["--volumes-from", args.music_container + ":ro"]
        cmd += [image, "/compare.py", *stage_args, "--output", "/results"]
        subprocess.run(cmd, check=True)

    if not (out / "manifest.json").exists():
        extra = ["prepare", "--music", args.music, "--seed", str(args.seed),
                 "--per-artist", str(args.per_artist)]
        if args.artists:
            extra += ["--artists", *args.artists]
        stage(worker_image, "python", extra, music=True)
    for name, image, python in [("openl3", worker_image, "python"),
                                 ("clap", ma_image, "/app/venv/bin/python")]:
        if not (out / f"{name}-metadata.json").exists():
            extra = ["infer", "--model", name, "--threads", str(args.threads)]
            if name == "clap" and args.text:
                extra += ["--text"]
            stage(image, python, extra)
    stage(worker_image, "python", ["report"])
    print(f"Report: {out / 'report.md'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["run", "prepare", "infer", "report"])
    parser.add_argument("--output", required=True)
    parser.add_argument("--music", default="/music")
    parser.add_argument("--music-container", default="music-recommender-web-1")
    parser.add_argument("--worker-container", default="music-recommender-worker-1")
    parser.add_argument("--ma-container", default="music-assistant-server")
    parser.add_argument("--seed", type=int, default=20261009)
    parser.add_argument("--per-artist", type=int, default=2)
    parser.add_argument("--artists", nargs="+")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--model", choices=["openl3", "clap"])
    parser.add_argument("--text", action="store_true")
    args = parser.parse_args()
    if args.threads < 1 or args.per_artist < 1:
        parser.error("threads and per-artist must be positive")
    if args.stage == "infer" and not args.model:
        parser.error("infer requires --model")
    {"run": run, "prepare": prepare, "infer": infer, "report": report}[args.stage](args)


if __name__ == "__main__":
    main()
