import { polygonToRect } from './geometry';

describe('polygonToRect', () => {
  it('scales a normalized rectangle to rendered pixels', () => {
    const rect = polygonToRect([0.1, 0.2, 0.5, 0.2, 0.5, 0.3, 0.1, 0.3], 600, 800);
    expect(rect.left).toBeCloseTo(60);
    expect(rect.top).toBeCloseTo(160);
    expect(rect.width).toBeCloseTo(240);
    expect(rect.height).toBeCloseTo(80);
  });

  it('keeps a minimum visible size for degenerate polygons', () => {
    const rect = polygonToRect([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 600, 800);
    expect(rect.width).toBeGreaterThanOrEqual(2);
    expect(rect.height).toBeGreaterThanOrEqual(2);
  });
});
