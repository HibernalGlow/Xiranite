from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "python" / "src"))

from xiranite_clipm.database import open_clipm_database  # noqa: E402
from xiranite_clipm.locks import exclusive_file_lock  # noqa: E402
from xiranite_clipm.model_bundle import (  # noqa: E402
    ModelBundleStore,
    load_trusted_pilot,
    register_model_bundle,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import the one trusted pilot-v2 joblib as a formal ClipM bundle")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--activate", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    runtime_root = args.runtime_root.resolve()
    source = args.source.resolve()
    evaluation = json.loads(args.evaluation.read_text(encoding="utf-8"))
    store = ModelBundleStore(runtime_root / "models")
    with exclusive_file_lock(runtime_root / "data" / "locks" / "model-activation.lock"):
        manifest = store.install_trusted_pilot(load_trusted_pilot(source), evaluation, source)
        connection = open_clipm_database(runtime_root / "data" / "clipm.sqlite")
        try:
            register_model_bundle(connection, store, manifest, activate=args.activate)
        finally:
            connection.close()
    print(json.dumps(manifest.model_dump(mode="json", by_alias=True), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
