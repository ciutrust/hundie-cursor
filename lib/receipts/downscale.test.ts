import { describe, expect, it } from "vitest";
import { MAX_EDGE, computeTargetSize } from "./downscale";

describe("computeTargetSize", () => {
  it("shrinks a landscape iPhone shot to the long edge", () => {
    // 4032x3024 (12MP, 4:3) is the common iPhone frame.
    expect(computeTargetSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });

  it("shrinks a portrait shot (a receipt is usually held upright)", () => {
    expect(computeTargetSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it("preserves the aspect ratio", () => {
    const { width, height } = computeTargetSize(4032, 3024);
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  it("never upscales a photo already under the limit", () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("leaves an image exactly at the limit alone", () => {
    expect(computeTargetSize(MAX_EDGE, 900)).toEqual({ width: MAX_EDGE, height: 900 });
  });

  it("honors a custom max edge", () => {
    expect(computeTargetSize(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
  });

  it("keeps the short edge at least 1px on an extreme panorama", () => {
    // 10000x3 would round the short edge to 0 and produce an unusable canvas.
    const { width, height } = computeTargetSize(10000, 3);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("returns zeros for nonsense dimensions instead of NaN", () => {
    for (const [w, h] of [
      [0, 0],
      [-4, 10],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
    ]) {
      expect(computeTargetSize(w, h)).toEqual({ width: 0, height: 0 });
    }
  });
});
