import { healthReportSchema } from './health';

describe('healthReportSchema', () => {
  it('accepts a valid report', () => {
    const report = {
      status: 'ok',
      checks: { postgres: 'up', blobStorage: 'up', queueStorage: 'up' },
    };
    expect(healthReportSchema.parse(report)).toEqual(report);
  });

  it('rejects an unknown check state', () => {
    const report = {
      status: 'ok',
      checks: { postgres: 'unknown', blobStorage: 'up', queueStorage: 'up' },
    };
    expect(healthReportSchema.safeParse(report).success).toBe(false);
  });

  it('rejects a missing check', () => {
    const report = { status: 'ok', checks: { postgres: 'up' } };
    expect(healthReportSchema.safeParse(report).success).toBe(false);
  });
});
