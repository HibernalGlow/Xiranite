from __future__ import annotations

from sqids import Sqids

from .filename import CM_WORK_CODE_ALPHABET


_CODEC = Sqids(alphabet=CM_WORK_CODE_ALPHABET, min_length=4, blocklist=[])


def encode_record_number(record_number: int) -> str:
    if isinstance(record_number, bool) or record_number < 1:
        raise ValueError("record number must be a positive integer")
    return _CODEC.encode([record_number])


def decode_canonical_short_code(short_code: str) -> int | None:
    decoded = _CODEC.decode(short_code)
    if len(decoded) != 1 or decoded[0] < 1:
        return None
    record_number = decoded[0]
    if encode_record_number(record_number) != short_code:
        return None
    return record_number
