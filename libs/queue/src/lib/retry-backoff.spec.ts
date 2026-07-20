import { retryBackoffSeconds } from './queue-consumer';

describe('retryBackoffSeconds', () => {
  it('grows exponentially from 30s and caps at 300s', () => {
    expect(retryBackoffSeconds(1)).toBe(30);
    expect(retryBackoffSeconds(2)).toBe(60);
    expect(retryBackoffSeconds(3)).toBe(120);
    expect(retryBackoffSeconds(4)).toBe(240);
    expect(retryBackoffSeconds(5)).toBe(300);
    expect(retryBackoffSeconds(10)).toBe(300);
  });
});
