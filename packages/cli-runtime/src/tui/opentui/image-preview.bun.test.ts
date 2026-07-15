import { expect, test } from "bun:test";
import sharp from "sharp";
import {
  decodeTerminalImageFrames,
  encodeRgbaToSixel,
  eraseTerminalGraphicsRect,
  projectRgbaToHalfBlocks,
  resolveTerminalImageBackend,
  writeTerminalBytes,
} from "./image-preview.js";

test("selects SIXEL before Kitty and half-block", () => {
  expect(
    resolveTerminalImageBackend("auto", {
      sixel: true,
      kitty_graphics: true,
    } as never),
  ).toBe("sixel");
  expect(
    resolveTerminalImageBackend("auto", {
      sixel: false,
      kitty_graphics: true,
    } as never),
  ).toBe("kitty");
  expect(resolveTerminalImageBackend("auto", null)).toBe("half-block");
});

test("projects RGBA pixels into portable upper-half terminal cells", () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255,
  ]);
  const rows = projectRgbaToHalfBlocks({ rgba, width: 2, height: 2 }, 2, 1);
  expect(rows[0]?.[0]).toEqual({
    character: "▀",
    foreground: "#ff0000",
    background: "#00ff00",
  });
  expect(rows[0]?.[1]).toEqual({
    character: "▀",
    foreground: "#0000ff",
    background: "#ffffff",
  });
});

test("encodes true-colour pixels as a complete SIXEL control sequence", () => {
  const encoded = new TextDecoder().decode(
    encodeRgbaToSixel({
      rgba: new Uint8Array([255, 0, 0, 255]),
      width: 1,
      height: 1,
    }),
  );
  expect(encoded).toStartWith("\u001bP");
  expect(encoded).toContain("\u001bP0;2;q");
  expect(encoded).toEndWith("\u001b\\");
});

test("writes graphic bytes as a byte-preserving string to OpenTUI", () => {
  let output: unknown;
  const renderer = {
    writeOut: (value: unknown) => {
      output = value;
      return true;
    },
  };
  writeTerminalBytes(
    renderer as never,
    new Uint8Array([0x1b, 0x50, 0x71, 0xff, 0x1b, 0x5c]),
  );

  expect(typeof output).toBe("string");
  expect(Buffer.from(output as string, "latin1")).toEqual(
    Buffer.from([0x1b, 0x50, 0x71, 0xff, 0x1b, 0x5c]),
  );
  expect(output).not.toContain("27,80,113");
});

test("disables SIXEL scrolling and erases the gallery rectangle with DECERA", () => {
  let output = "";
  eraseTerminalGraphicsRect(
    {
      writeOut: (value: string) => {
        output += value;
        return true;
      },
    } as never,
    4,
    7,
    20,
    6,
  );
  expect(output).toContain("\u001b[?80l");
  expect(output).toContain("\u001b[8;5;13;24$z");
});

test("decodes animated GIF pages and preserves frame delays", async () => {
  const rgba = Buffer.concat([
    Buffer.from([255, 0, 0, 255, 255, 0, 0, 255]),
    Buffer.from([0, 0, 255, 255, 0, 0, 255, 255]),
  ]);
  const gif = await sharp(rgba, {
    raw: { width: 2, height: 2, channels: 4, pageHeight: 1 },
  })
    .gif({ loop: 0, delay: [60, 90] })
    .toBuffer();
  const frames = await decodeTerminalImageFrames(gif, 2, 1, "cover", 8);
  expect(frames).toHaveLength(2);
  expect(frames.map((frame) => frame.delayMs)).toEqual([60, 90]);
});

test("decodes a Web stream without collecting the original image in the caller", async () => {
  const png = await sharp({
    create: { width: 4, height: 6, channels: 4, background: "#4c8f6b" },
  }).png().toBuffer();
  const stream = new Blob([png]).stream() as ReadableStream<Uint8Array>;
  const frames = await decodeTerminalImageFrames(stream, 8, 8, "contain", 1);

  expect(frames).toHaveLength(1);
  expect(frames[0]?.width).toBeLessThanOrEqual(8);
  expect(frames[0]?.height).toBeLessThanOrEqual(8);
  expect(frames[0]?.png.length).toBeGreaterThan(0);
});
