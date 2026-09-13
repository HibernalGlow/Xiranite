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
