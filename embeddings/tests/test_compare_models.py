"""Sanity checks for experiment metrics using known identical representations."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np

SPEC = importlib.util.spec_from_file_location(
    "compare_models", Path(__file__).resolve().parents[1] / "compare_models.py"
)
comparison = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(comparison)


class ComparisonReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        tracks = [{"id": str(i), "artist": f"artist{i}", "title": f"song{i}"}
                  for i in range(7)]
        comparison.save(self.out / "manifest.json", {
            "seed": 1, "tracks": tracks, "sampling": "fixture", "prompts": []
        })
        vectors = np.random.default_rng(1).normal(size=(7, 9))
        # Scale and pad one representation: cosine rankings must remain identical
        # despite different dimensions and norms.
        for name, values in [("openl3", vectors),
                             ("clap", np.pad(vectors * 3, ((0, 0), (0, 4))))]:
            np.savez(self.out / f"{name}.npz", vectors=values,
                     windows=np.repeat(values[:, None, :], 3, axis=1))
            comparison.save(self.out / f"{name}-metadata.json", {
                "track_ids": [str(i) for i in range(7)],
                "dimensions": values.shape[1], "load_seconds": 0,
                "median_inference_seconds": 0, "total_inference_seconds": 0,
            })

    def test_identical_cosine_geometry_and_no_self_retrieval(self):
        with contextlib.redirect_stdout(io.StringIO()):
            comparison.report(SimpleNamespace(output=str(self.out)))
        result = json.loads((self.out / "results.json").read_text())
        metrics = result["comparisons_to_clap"]["openl3"]
        self.assertAlmostEqual(metrics["pairwise_spearman"], 1)
        self.assertEqual(metrics["top1_agreement"], 1)
        self.assertEqual(metrics["mean_top5_overlap_fraction"], 1)
        for seed, representations in result["neighbours"].items():
            for entries in representations.values():
                self.assertTrue(all(entry["id"] != seed for entry in entries))
        for metrics in result["sampling_stability"].values():
            self.assertEqual(metrics["first_window_vs_three_window_top5_overlap"], 1)

    def test_rejects_mismatched_track_order(self):
        path = self.out / "clap-metadata.json"
        meta = json.loads(path.read_text())
        meta["track_ids"].reverse()
        comparison.save(path, meta)
        with self.assertRaisesRegex(ValueError, "ordering mismatch"):
            comparison.report(SimpleNamespace(output=str(self.out)))


if __name__ == "__main__":
    unittest.main()
