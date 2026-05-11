import { expect } from 'chai';
import { computeUtilization, buildBar, buildMiniBar, formatPercent, fmtHours, calculateCost } from '../src/calc';
import { QuotaData, TokenPricing } from '../src/types';

describe('calc', () => {
  describe('computeUtilization', () => {
    it('returns zero for null quota', () => {
      const r = computeUtilization(null);
      expect(r.weeklyPct).to.equal(0);
      expect(r.windowPct).to.equal(0);
    });

    it('computes percentages correctly', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 250, weeklyLimit: 1000, weeklyUsedPct: 25, windowUsed: 100, windowLimit: 200, windowUsedPct: 50 }));
      expect(r.weeklyUtil).to.equal(0.25);
      expect(r.windowUtil).to.equal(0.5);
      expect(r.weeklyPct).to.equal(25);
      expect(r.windowPct).to.equal(50);
    });

    it('caps at 100%', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 1500, weeklyLimit: 1000, weeklyUsedPct: 150 }));
      expect(r.weeklyPct).to.equal(100);
    });

    it('handles zero limit gracefully', () => {
      const r = computeUtilization(makeQuota({ weeklyLimit: 0, windowLimit: 0 }));
      expect(r.weeklyUtil).to.equal(0);
      expect(r.windowUtil).to.equal(0);
    });
  });

  describe('buildBar', () => {
    it('renders full bar at 100%', () => {
      expect(buildBar(1, 10)).to.equal('\u25B0'.repeat(10));
    });
    it('renders empty bar at 0%', () => {
      expect(buildBar(0, 10)).to.equal('\u25B1'.repeat(10));
    });
    it('renders partial bar', () => {
      expect(buildBar(0.25, 10)).to.equal('\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1');
    });
  });

  describe('buildMiniBar', () => {
    it('renders 5-char mini bar', () => {
      expect(buildMiniBar(0.4, 5)).to.equal('\u25B0\u25B0\u25B1\u25B1\u25B1');
    });
  });

  describe('calculateCost', () => {
    it('calculates cost from tokens and pricing', () => {
      const pricing: TokenPricing = {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheCreatePerMillion: 3.75,
      };
      const cost = calculateCost(
        { inputOther: 1_000_000, output: 500_000, inputCacheRead: 0, inputCacheCreation: 0 },
        pricing,
      );
      expect(cost).to.equal(10.5); // 3 + 7.5
    });
  });

  describe('fmtHours', () => {
    it('formats seconds', () => {
      expect(fmtHours(0.0083)).to.equal('30s'); // ~30 seconds
    });
    it('formats minutes and seconds', () => {
      expect(fmtHours(0.5)).to.equal('30m 0s');
    });
    it('formats hours and minutes', () => {
      expect(fmtHours(2.5)).to.equal(' 2h30m');
    });
    it('formats days and hours', () => {
      expect(fmtHours(50)).to.equal(' 2d 2h');
    });
    it('pads single digits with space', () => {
      expect(fmtHours(0.0167)).to.equal(' 1m 0s'); // ~1 minute
      expect(fmtHours(1)).to.equal(' 1h 0m');
      expect(fmtHours(24)).to.equal(' 1d 0h');
    });
  });
});

function makeQuota(partial: Partial<QuotaData> = {}): QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 0, weeklyUsedPct: 0, weeklyResetAt: 0,
    windowLimit: 200, windowUsed: 0, windowRemaining: 200, windowUsedPct: 0, windowResetAt: 0,
    parallelLimit: 30,
    ...partial,
  };
}
