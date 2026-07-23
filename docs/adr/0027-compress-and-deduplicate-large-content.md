---
status: accepted
---

# Compress and deduplicate large content

Text and JSON payloads larger than 4 KiB will be canonicalized, addressed by the SHA-256 hash of their uncompressed bytes, and compressed with Brotli quality 4. Xiranite runtime storage keeps compressed binary Content Blobs with codec, raw size, compressed size, and hash metadata; jobs and revisions reference blobs instead of duplicating payloads, and decompression verifies integrity. Large snapshots embedded in a JSON Project Document use the same compressed representation encoded as Base64. Unreferenced runtime blobs are removed only by explicit record cleanup and garbage collection.
