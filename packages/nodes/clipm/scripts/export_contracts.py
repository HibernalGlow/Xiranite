from __future__ import annotations

import json
from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = PACKAGE_ROOT / "python" / "src"
sys.path.insert(0, str(PYTHON_SRC))

from xiranite_clipm.contracts import CONTRACT_MODELS, CmScoreDocument  # noqa: E402


def export_contract_catalog() -> dict[str, object]:
    definitions: dict[str, object] = {}
    properties: dict[str, object] = {}
    for model in CONTRACT_MODELS:
        schema = model.model_json_schema(by_alias=True, ref_template="#/$defs/{model}")
        definitions.update(schema.pop("$defs", {}))
        definitions[model.__name__] = schema
        properties[model.__name__] = {"$ref": f"#/$defs/{model.__name__}"}
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://xiranite.local/contracts/clipm/v1",
        "title": "ClipmContractCatalog",
        "description": "Generated catalog of ClipM MCP and persistence wire contracts.",
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
        "$defs": definitions,
    }


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    contracts_root = PACKAGE_ROOT / "contracts"
    metadata_schema = CmScoreDocument.model_json_schema(by_alias=True, ref_template="#/$defs/{model}")
    metadata_schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    metadata_schema["$id"] = "https://xiranite.local/contracts/clipm/cm-score-v1"
    write_json(
        contracts_root / "cm-score.schema.json",
        metadata_schema,
    )
    write_json(contracts_root / "clipm-contract.schema.json", export_contract_catalog())


if __name__ == "__main__":
    main()
