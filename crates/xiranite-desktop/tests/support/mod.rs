//! A dependency-free HTTP/1.1 client for the loopback channel.
//!
//! Why `std::net` and hand-written framing: the desktop manifest pins `tauri`, `tauri-build`,
//! `axum`, `tokio`, `serde_json`, `serde`, `getrandom` and the three workspace crates, and adding a
//! test-only HTTP client (or `tower`/`http-body-util` for `oneshot`) would widen that surface for one
//! assertion path. `std::net::TcpStream` needs no Cargo feature at all, whereas `tokio::net` reads
//! would need `io-util`; the host owns its own runtime thread, so a blocking client on the test
//! thread is the shorter code and the same evidence.
//!
//! `Connection: close` is sent on every request, so the end of the body is always the end of the
//! socket: no keep-alive bookkeeping, and the NDJSON stream is proven closed by the server's `result`
//! frame the way `routes.rs` promises.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Long enough for a graceful shutdown, short enough that a hung route fails the test instead of the
/// whole suite.
pub const READ_TIMEOUT: Duration = Duration::from_secs(8);

/// One parsed response.
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    /// Case-insensitive header lookup, because HTTP field names are.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// The body as text, lossy so a truncated frame never panics the assertion path.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    /// The body as JSON. A plain-text `401 Unauthorized` is kept as a string, matching what the
    /// WebView's own reader would see.
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body)
            .unwrap_or_else(|_| serde_json::Value::String(self.text()))
    }

    /// The body split on newlines, dropping the empty trailing element an NDJSON stream ends with.
    pub fn ndjson(&self) -> Vec<serde_json::Value> {
        self.text()
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }
}

/// One request/response exchange against `base_url` (`http://127.0.0.1:{port}`).
///
/// Panics with the full request line on any I/O failure: a test that cannot reach the channel has no
/// assertion left to make.
#[must_use]
pub fn request(
    base_url: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Reply {
    exchange(base_url, method, path, headers, body, READ_TIMEOUT)
        .unwrap_or_else(|error| panic!("{method} {path} against {base_url} failed: {error}"))
}

/// The same exchange with a caller-chosen read timeout, for the case where the expected outcome is
/// that the socket is gone. No `#[must_use]`: the `Result` it returns is already one.
pub fn try_request(
    base_url: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<Reply, std::io::Error> {
    exchange(base_url, method, path, headers, body, timeout)
}

/// Re-reads the channel from a fresh socket, proving no connection state is being relied on.
fn exchange(
    base_url: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<Reply, std::io::Error> {
    let authority = authority_of(base_url);
    let mut stream = TcpStream::connect(authority.as_str())?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let mut wire = format!("{method} {path} HTTP/1.1\r\nhost: {authority}\r\nconnection: close\r\n");
    for (name, value) in headers {
        wire.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(body) = body {
        wire.push_str(&format!("content-length: {}\r\n", body.len()));
    }
    wire.push_str("\r\n");
    stream.write_all(wire.as_bytes())?;
    if let Some(body) = body {
        stream.write_all(body.as_bytes())?;
    }
    stream.flush()?;

    read_reply(stream)
}

/// Strips the scheme from `http://127.0.0.1:PORT` and returns the `host:port` authority.
fn authority_of(base_url: &str) -> String {
    let rest = base_url
        .strip_prefix("http://")
        .unwrap_or_else(|| panic!("the host channel must publish an http:// origin, got {base_url}"));
    rest.trim_end_matches('/').to_owned()
}

fn read_reply(stream: TcpStream) -> Result<Reply, std::io::Error> {
    let mut reader = BufReader::new(stream);
    let status_line = read_line(&mut reader)?
        .ok_or_else(|| std::io::Error::other("the channel closed before a status line"))?;
    let status = parse_status(&status_line)?;

    let mut headers = Vec::new();
    loop {
        let line = read_line(&mut reader)?
            .ok_or_else(|| std::io::Error::other("the channel closed inside the header block"))?;
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_owned(), value.trim().to_owned()));
        }
    }

    let body = if header_value(&headers, "transfer-encoding").is_some_and(|value| value.contains("chunked")) {
        read_chunked(&mut reader)?
    } else if let Some(length) = header_value(&headers, "content-length").and_then(|value| value.parse::<usize>().ok()) {
        let mut buffer = vec![0_u8; length];
        reader.read_exact(&mut buffer)?;
        buffer
    } else {
        // `connection: close` means the socket is the body's end marker; a read timeout is the
        // server still holding an open stream, which is answered with whatever arrived so far.
        let mut buffer = Vec::new();
        let mut window = [0_u8; 8192];
        loop {
            match reader.read(&mut window) {
                Ok(0) => break,
                Ok(read) => buffer.extend_from_slice(&window[..read]),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    break
                }
                Err(error) => return Err(error),
            }
        }
        buffer
    };

    Ok(Reply { status, headers, body })
}

/// A line without its CRLF, or `None` at a clean EOF. A read timeout is reported as EOF-with-nothing,
/// which the callers above turn into either an error or an empty body.
fn read_line<R: BufRead>(reader: &mut R) -> Result<Option<String>, std::io::Error> {
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(0) => Ok(None),
        Ok(_) => {
            while line.ends_with('\n') || line.ends_with('\r') {
                line.pop();
            }
            Ok(Some(line))
        }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut || error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
        Err(error) => Err(error),
    }
}

fn parse_status(line: &str) -> Result<u16, std::io::Error> {
    let (_, code) = line
        .split_once(' ')
        .ok_or_else(|| std::io::Error::other(format!("malformed status line: {line}")))?;
    code.split_whitespace()
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| std::io::Error::other(format!("malformed status code: {line}")))
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn read_chunked<R: BufRead>(reader: &mut R) -> Result<Vec<u8>, std::io::Error> {
    let mut body = Vec::new();
    loop {
        let size_line = read_line(reader)?
            .ok_or_else(|| std::io::Error::other("the channel closed inside a chunked body"))?;
        let size = usize::from_str_radix(size_line.split(';').next().unwrap_or_default().trim(), 16)
            .map_err(|_| std::io::Error::other(format!("malformed chunk size: {size_line}")))?;
        if size == 0 {
            // Trailing headers, then the blank line; nobody reads them, so they are drained if present.
            while let Some(line) = read_line(reader)? {
                if line.is_empty() {
                    break;
                }
            }
            return Ok(body);
        }
        let mut chunk = vec![0_u8; size];
        reader.read_exact(&mut chunk)?;
        body.extend_from_slice(&chunk);
        // The CRLF that follows every chunk.
        let mut terminator = [0_u8; 2];
        reader.read_exact(&mut terminator)?;
    }
}
