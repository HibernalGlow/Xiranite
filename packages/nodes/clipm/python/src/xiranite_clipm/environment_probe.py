from __future__ import annotations

import sys

from .service import ClipmService
from .settings import ClipmSettings


def main() -> None:
    service = ClipmService(ClipmSettings.from_environment())
    try:
        status = service.health()
        sys.stdout.write(status.model_dump_json(by_alias=True) + "\n")
    finally:
        service.close()


if __name__ == "__main__":
    main()
