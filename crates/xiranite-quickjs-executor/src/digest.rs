//! The host's digests: one implementation of `crypto.digest`, in Rust, next to the bytes.
//!
//! ## Why a crate and not a local implementation
//!
//! A hash has to have exactly one implementation in this product. The measured call sites (`clipm`'s
//! `uv-bootstrap.ts` verifying a downloaded archive, `comfygure`'s `project.ts` fingerprinting a workflow
//! graph) call Node's `createHash("sha256")`, and the answer has to be the same text the HTTP protocol and
//! the operation journals already record — so the digest cannot live in the JavaScript shim, where a second
//! SHA-256 would sit next to the host's own and drift silently.
//!
//! The arithmetic itself is RustCrypto's `sha1`/`sha2`, the same line the rest of the workspace already
//! resolves (`sha2 0.10.9` in the root `Cargo.lock`). An earlier revision of this file hand-wrote both
//! compressions; the moment they ran they failed four of their own OpenSSL-produced vectors, including the
//! empty message, which is the case that catches a padding bug by accident rather than by design. A hashed
//! digest is a correctness claim about somebody else's file, so it is not a place to be sparing with
//! dependencies (see the reuse rule in `AGENTS.md`).
//!
//! MD5, SHA-512 and the HMAC family stay refused by name: no node in the retained set asks for them, and an
//! implementation nobody exercises is a liability rather than a capability.
//!
//! ## The shape of the answer
//!
//! `crypto.digest(algorithm, bytes)` answers `{ hex }` because a digest is 40 or 64 *text* characters. The
//! bytes that go **in** arrive on the payload channel (`__xrh.sendBytes`), never base64 inside the JSON
//! arguments: the ceiling on the input is a file, the ceiling on the output is a hash.

// `sha1` and `sha2` re-export the same `digest::Digest` trait; one import serves both arms.
use sha2::Digest as _;

/// A digest the host answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    /// FIPS 180-4 SHA-1.
    Sha1,
    /// FIPS 180-4 SHA-256.
    Sha256,
}

impl Algorithm {
    /// Node's spelling, plus the aliases a caller reaches for.
    ///
    /// Node accepts `sha256`, `SHA256` and `sha-256` for one algorithm. Anything else parses to `None` and
    /// the caller is refused with the list this host answers, because silently picking a digest for `"md5"`
    /// would be worse than an error: the node would compare it against somebody else's md5.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        let normalized = name.to_ascii_lowercase().replace('-', "");
        match normalized.as_str() {
            "sha1" => Some(Self::Sha1),
            "sha256" => Some(Self::Sha256),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sha1 => "sha1",
            Self::Sha256 => "sha256",
        }
    }

    /// The digest length in bytes.
    #[must_use]
    pub const fn output_bytes(self) -> usize {
        match self {
            Self::Sha1 => 20,
            Self::Sha256 => 32,
        }
    }

    /// The algorithms this host answers, for the refusal message.
    pub fn names() -> Vec<&'static str> {
        vec![Self::Sha1.as_str(), Self::Sha256.as_str()]
    }

    /// Hashes `message` into lowercase hex, the text `createHash(alg).update(bytes).digest("hex")` gives.
    #[must_use]
    pub fn digest_hex(self, message: &[u8]) -> String {
        let bytes: Vec<u8> = match self {
            Self::Sha1 => sha1::Sha1::new().chain_update(message).finalize().to_vec(),
            Self::Sha256 => sha2::Sha256::new().chain_update(message).finalize().to_vec(),
        };
        debug_assert_eq!(bytes.len(), self.output_bytes(), "a digest crate at the wrong width");
        crate::host_calls::hex(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::Algorithm;

    /// One row per case, each expected digest produced by OpenSSL on this machine (`openssl dgst -sha1
    /// -hex`, `-sha256 -hex`) rather than recalled. The set is chosen to hit the arms that break first:
    /// the empty message, a one-block message, the 55/56-byte padding seam, an exact block, two blocks, a
    /// non-ASCII byte sequence, and the 1 000 000-byte NIST case.
    fn case(label: &str, input: &[u8], sha1: &str, sha256: &str) {
        assert_eq!(Algorithm::Sha1.digest_hex(input), sha1, "{label}: sha1");
        assert_eq!(Algorithm::Sha256.digest_hex(input), sha256, "{label}: sha256");
        assert_eq!(
            Algorithm::Sha1.digest_hex(input).len(),
            Algorithm::Sha1.output_bytes() * 2,
            "{label}: sha1 length"
        );
        assert_eq!(
            Algorithm::Sha256.digest_hex(input).len(),
            Algorithm::Sha256.output_bytes() * 2,
            "{label}: sha256 length"
        );
    }

    #[test]
    fn the_empty_message_and_the_three_byte_abc() {
        // NIST's `"abc"` pair, which is also what OpenSSL answers here.
        case("empty", b"", "da39a3ee5e6b4b0d3255bfef95601890afd80709", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        case("abc", b"abc", "a9993e364706816aba3e25717850c26c9cd0d89d", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn the_padding_seam_and_the_block_boundaries() {
        // 55 bytes: the message plus `0x80` fits before the length field. 56 bytes: it does not, so a
        // whole extra block of zeros is added. One wrong `%` and both arms move together.
        case("a x55", &[b'a'; 55], "c1c8bbdc22796e28c0e15163d20899b65621d65a", "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
        case("a x56", &[b'a'; 56], "c2db330f6083854c99d4b5bfb6e8f29f201be699", "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
        case("a x64", &[b'a'; 64], "0098ba824b5c16427bd7a1122a5a442a25ec644d", "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
        case("a x112", &[b'a'; 112], "689993727ba37386bb032495e9dbdfb4dd1ba744", "f54353008a2553262ecdc4a34749563ba0950e8b0fc8652780b0a614b99683c1");
    }

    #[test]
    fn a_non_ascii_input_is_hashed_as_bytes_not_as_code_units() {
        // UTF-8 for 中文: six bytes. A shim-side JS hash over the *string* would agree here by luck and
        // disagree for a Latin-1 buffer; the host hashes bytes, which is what a file digest means.
        case("中文", "中文".as_bytes(), "7be2d2d20c106eee0836c9bc2b939890a78e8fb3", "72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21");
    }

    #[test]
    fn every_byte_value_and_the_long_message() {
        // 0x00..=0xff repeated, to catch an endianness or carry bug the short vectors can step past.
        let mixed: Vec<u8> = (0u8..=255).cycle().take(1_792).collect();
        case("bytes x7", &mixed, "b579cea40054dc7dbb2b1e84f61e89dd17cd883f", "a3652ad1f4cb62f8cec5a16bf51b158f2f538cbeaa72c8d647fcdac6b1cc6cfa");
        // NIST's one-megabyte case, and the reason the loop is `chunks_exact` rather than one big buffer.
        let million = vec![b'a'; 1_000_000];
        case("a x1e6", &million, "34aa973cd4c4daa4f61eeb2bdbad27316534016f", "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    #[test]
    fn the_digest_is_lowercase_hex_of_the_published_length() {
        let hex = Algorithm::Sha256.digest_hex(b"hello");
        assert!(hex.bytes().all(|bit| bit.is_ascii_hexdigit()), "{hex}");
        assert_eq!(hex, hex.to_lowercase(), "Node's digest(\"hex\") is lowercase");
        // Both algorithms at their published widths: 40 and 64 hex characters, never a truncated buffer.
        assert_eq!(Algorithm::Sha1.digest_hex(b"abc").len(), Algorithm::Sha1.output_bytes() * 2);
        assert_eq!(Algorithm::Sha256.digest_hex(b"abc").len(), Algorithm::Sha256.output_bytes() * 2);
    }

    #[test]
    fn the_algorithm_names_are_node_tolerant_and_unknown_names_parse_to_nothing() {
        for spelling in ["sha256", "SHA256", "sha-256", "Sha-256"] {
            assert_eq!(Algorithm::parse(spelling), Some(Algorithm::Sha256), "{spelling}");
        }
        for spelling in ["sha1", "SHA-1", "Sha1"] {
            assert_eq!(Algorithm::parse(spelling), Some(Algorithm::Sha1), "{spelling}");
        }
        // The refused set is stated so the host's error text can name it: a caller asking for md5 is told
        // this host does not answer md5, not handed a sha256 it would compare against somebody else's.
        for spelling in ["md5", "sha512", "sha384", "blake3", ""] {
            assert_eq!(Algorithm::parse(spelling), None, "{spelling} must not silently pick one");
        }
        assert_eq!(Algorithm::names(), vec!["sha1", "sha256"]);
    }
}
