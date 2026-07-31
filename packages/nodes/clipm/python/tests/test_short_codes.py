from __future__ import annotations

import pytest

from xiranite_clipm.short_codes import decode_canonical_short_code, encode_record_number


@pytest.mark.parametrize("record_number", [1, 2, 1234, 1_000_000])
def test_short_code_round_trip_is_canonical(record_number: int) -> None:
    short_code = encode_record_number(record_number)
    assert len(short_code) >= 4
    assert decode_canonical_short_code(short_code) == record_number


def test_rejects_noncanonical_or_invalid_codes() -> None:
    short_code = encode_record_number(1234)
    assert decode_canonical_short_code(short_code.lower()) is None
    assert decode_canonical_short_code(short_code + "0") is None
    assert decode_canonical_short_code("OILU") is None


@pytest.mark.parametrize("record_number", [0, -1, True])
def test_record_numbers_must_be_positive_integers(record_number: int) -> None:
    with pytest.raises(ValueError):
        encode_record_number(record_number)
