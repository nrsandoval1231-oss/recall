import { describe, expect, it } from "vitest";
import { sniffMediaType } from "./sniff";

// Synthetic signature bytes only; these fixtures are not captured image files.
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff);
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ascii = (value: string) => Array.from(value, (char) => char.charCodeAt(0));
const ftyp = (brand: string) => Uint8Array.from([0, 0, 0, 12, ...ascii("ftyp"), ...ascii(brand)]);

describe("sniffMediaType", () => {
  it.each([
    ["JPEG", jpeg, "image/jpeg"],
    ["PNG", png, "image/png"],
  ] as const)("recognizes the complete %s signature with or without trailing bytes", (_name, signature, mediaType) => {
    expect(sniffMediaType(signature)).toBe(mediaType);
    expect(sniffMediaType(Uint8Array.from([...signature, 0, 1, 2]))).toBe(mediaType);
  });

  it.each(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"])(
    "recognizes HEIC major brand %s",
    (brand) => expect(sniffMediaType(ftyp(brand))).toBe("image/heic"),
  );

  it.each(["mif1", "msf1"])("recognizes HEIF major brand %s", (brand) => {
    expect(sniffMediaType(ftyp(brand))).toBe("image/heif");
  });

  it("rejects empty input", () => {
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });

  it.each([
    ["JPEG", jpeg],
    ["PNG", png],
    ...["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].map(
      (brand) => [brand, ftyp(brand)] as const,
    ),
  ] as const)("rejects every nonempty truncated %s signature", (_name, signature) => {
    for (let length = 1; length < signature.length; length++) {
      expect(sniffMediaType(signature.slice(0, length))).toBeNull();
    }
  });

  it.each([
    ["arbitrary bytes", Uint8Array.of(1, 2, 3, 4)],
    ["GIF", Uint8Array.from(ascii("GIF89a"))],
    ["unsupported major brand", ftyp("avif")],
    ["uppercase major brand", ftyp("HEIC")],
    ["supported compatible brand only", Uint8Array.from([...ftyp("avif"), 0, 0, 0, 0, ...ascii("heic")])],
    ["misplaced ftyp", Uint8Array.from([0, ...ftyp("heic")])],
    ["incorrect box type", Uint8Array.from([0, 0, 0, 12, ...ascii("freeheic")])],
    ["incorrect JPEG prefix", Uint8Array.of(0xff, 0xd8, 0xfe)],
    ["incorrect PNG signature", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0)],
  ] as const)("rejects %s", (_name, signature) => {
    expect(sniffMediaType(signature)).toBeNull();
  });
});
