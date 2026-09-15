---
status: accepted
---

# Render Neoxide clients locally with independent viewing sessions

The browser will run the shared egui interface as WASM and draw locally through
WebGPU into its Canvas. It will continue using Neoxide's native core and remote
service for files, business data, and existing media capabilities. Native clients
retain their native GPU paths, including the Windows D3D11 video presenter and
DX12 egui HUD overlay. Rendering performance takes priority; neither client is a
remote desktop view, and egui draw commands are not transported from the core to
drive browser frames.

Desktop and browser clients have independent, simultaneously operable viewing
sessions. Opening B in the browser leaves the desktop viewing A. Files and business
records are shared; view state and operation ownership are scoped to each session.
This deliberately replaces Remote's current exclusive takeover contract. Worker
completion, cancellation, cache leases, and GPU budgets must respect session
identity so closing one client cannot invalidate another client's resources.

## Shared resume position and service lifetime

Clients share one resume position per book. Reopening that book uses the shared
position; already-open sessions keep their own displayed page and remain operable.
This replaces the interview recommendation of separate per-client resume points.
The core remains the authoritative writer. Order legitimate progress updates and
reject stale completions or close-time snapshots; background prefetch and decode
completion must not overwrite a user's newer reading position. This requires a
defined update/version contract, not a second database writer in each client.

Closing the desktop window must leave browser use available. Browser execution
and the serving core/remote runtime have lifetimes independent of the desktop
view's visibility. The runtime keeps serving requests when the native view closes;
stopping the service is an explicit lifecycle operation. Reuse existing workers,
persistence, and media processing, with the native GPU fast paths intact. This
decision does not require moving native frame rendering through service IPC.

The supported network scope includes LAN use and optional public Internet access.
Use a secure browser origin and authenticated endpoints. A public port alone does
not supply HTTPS. Define TLS termination, the advertised origin, and which proxy
sources may supply forwarding headers; arbitrary peers must not determine their
own trusted scheme or source address through request headers. These are delivery
contracts for the remote gateway, not a requirement to expose core IPC publicly.

## Decode location and rendering location are separate

Server-side decoding and media processing remain compatible with local browser
rendering. The service may read archives, render PDF pages, run AI, decode a source,
or transcode media; it returns media resources and structured results. Browser
input, layout, scrolling, zooming, and composition run locally. Backend IPC may
carry business commands, media jobs, and their results without becoming a
per-frame UI rendering protocol.

Canvas is the output surface. Canvas 2D, WebGL, and WebGPU are different rendering
contexts that can target it. WebGPU was selected to fit egui/wgpu, shader reuse,
and local GPU composition, not because every WebGPU path is automatically faster
than every Canvas 2D path. Canvas 2D may also use GPU acceleration.

The media transport choice remains subject to measurement:

- Encoded original images or server-generated JPEG/WebP/other resources require
  browser decoding of the transport format before texture upload.
- Raw decoded pixels avoid that codec step but increase transfer volume, memory
  traffic, and upload work. As a scale example, 3840 × 2160 RGBA8 at 60 frames/s
  is about 1.99 GB/s before protocol overhead; this is arithmetic, not a benchmark.
- Video may use browser decoding of an encoded stream or necessary server-side
  transcoding for compatibility. This transports video content, never a capture
  of the desktop interface. Codec support, seek latency, copies, and GPU upload
  need comparison before selecting individual paths.

Native texture handles cannot be passed directly to an ordinary browser as a
shared desktop texture. No end-to-end zero-copy claim is made by choosing WebGPU.

## Delivery and verification

The current development and acceptance target is Windows at a user-specified
2560-pixel-wide, 60 Hz display mode, with a frame budget of about 16.7 ms. Record
the actual viewport height, backing-pixel size, scaling, and display mode when
measuring. Source content includes 4K AVIF images and video; image resolution and
display resolution are separate inputs. MacBook Air M5 remains a future macOS
adaptation target. The earlier 120 fps request is not the current delivery gate.

Preserve the existing fluid image/video transitions and media algorithms. Measure
input/paint cadence separately from first decode/download and next-media first
frame latency. A 60 Hz UI target does not require decoding 60 distinct source
images per second or changing a video's native frame rate. Verify warm-cache and
cold-cache behavior, first-ready-frame handoff, cancellation, and concurrent clients
without using average frame rate alone to hide stalls.

WebGPU is required for this browser frontend. Remote access needs a compatible
secure context, such as existing HTTPS/Tailscale support; localhost is also valid.
The current generic HTTP LAN fallback is not sufficient evidence of WebGPU support.
The WASM feature graph must also select the wgpu painter explicitly: the vendored
eframe web module prefers Glow when both Glow and wgpu are enabled. Verify the
actual browser backend rather than assuming that adding the wgpu feature selects it.

Use the same content, viewport, output quality, and warm/cold cache conditions to
compare frame time and input latency, first-page/seek latency, media bandwidth,
CPU time, allocations, GPU uploads, and resident memory. Measure while another
client is active as well as alone. Preserve the native baseline and bound shared
worker/GPU resource use. Actual budgets and results belong to the implementation
evidence; no benchmark has been run for this decision.
