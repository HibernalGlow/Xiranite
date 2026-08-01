from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the CM sklearn head for the TypeScript runtime")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    bundle = joblib.load(args.input)
    pipeline = bundle["model"]
    scaler = pipeline.named_steps["scale"]
    classifier = pipeline.named_steps["classifier"]
    output = {
        "format": "xiranite.cm-classifier",
        "formatVersion": 1,
        "embedding": bundle["embedding"],
        "pooling": bundle["pooling"],
        "featureDimension": int(bundle["feature_dimension"]),
        "threshold": float(bundle["threshold"]),
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "logisticRegression": {
            "coefficients": classifier.coef_[0].tolist(),
            "intercept": float(classifier.intercept_[0]),
        },
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
