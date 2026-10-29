import { describe, expect, test } from 'bun:test';
import { describeArtist, summarizeDistribution } from './artist-distribution';

describe('summarizeDistribution', () => {
	test('an empty distribution has no numbers rather than NaN', () => {
		expect(summarizeDistribution([], 52)).toEqual({
			clusteredTracks: 0,
			clusterCount: 0,
			topShare: 0,
			spread: 0,
			evenness: 0,
			reach: 0
		});
		expect(summarizeDistribution([0, 0], 52).topShare).toBe(0);
	});

	test('everything in one cluster is fully focused and not even', () => {
		const summary = summarizeDistribution([10], 52);
		expect(summary.clusteredTracks).toBe(10);
		expect(summary.clusterCount).toBe(1);
		expect(summary.topShare).toBe(1);
		expect(summary.spread).toBeCloseTo(1, 5);
		expect(summary.evenness).toBe(0);
		expect(summary.reach).toBeCloseTo(1 / 52, 5);
	});

	test('a flat spread over half the map is even and reaches half', () => {
		const summary = summarizeDistribution(
			Array.from({ length: 26 }, () => 10),
			52
		);
		expect(summary.clusteredTracks).toBe(260);
		expect(summary.clusterCount).toBe(26);
		expect(summary.topShare).toBeCloseTo(1 / 26, 5);
		// exp(entropy) is the number of equal buckets that look the same.
		expect(summary.spread).toBeCloseTo(26, 5);
		expect(summary.evenness).toBeCloseTo(1, 5);
		expect(summary.reach).toBeCloseTo(0.5, 5);
	});

	test('a long tail lowers evenness without changing the leader', () => {
		const summary = summarizeDistribution([90, 6, 3, 1], 52);
		expect(summary.topShare).toBeCloseTo(0.9, 5);
		expect(summary.spread).toBeLessThan(2);
		expect(summary.evenness).toBeLessThan(0.3);
	});

	test('zero, negative and NaN buckets are ignored', () => {
		const summary = summarizeDistribution([5, 0, -3, Number.NaN, 5], 52);
		expect(summary.clusteredTracks).toBe(10);
		expect(summary.clusterCount).toBe(2);
		expect(summary.topShare).toBeCloseTo(0.5, 5);
	});

	test('a zero-sized cluster space still yields finite numbers', () => {
		const summary = summarizeDistribution([1, 1], 0);
		expect(summary.reach).toBe(1);
		expect(Number.isFinite(summary.evenness)).toBe(true);
	});
});

describe('describeArtist', () => {
	const options = { dominantName: 'Sparse, Emotional Vocal Pop', totalClusters: 52 };

	test('no clustered tracks reads as uncharted', () => {
		const verdict = describeArtist(summarizeDistribution([], 52), options);
		expect(verdict.label).toBe('Uncharted');
	});

	test('one cluster is a one-track mind', () => {
		const verdict = describeArtist(summarizeDistribution([8], 52), options);
		expect(verdict.label).toBe('One-track mind');
		expect(verdict.text).toContain('Sparse, Emotional Vocal Pop');
	});

	test('a broad, flat artist is omnipresent', () => {
		const spread = Array.from({ length: 40 }, () => 4);
		const verdict = describeArtist(summarizeDistribution(spread, 52), options);
		expect(verdict.label).toBe('Omnipresent');
		expect(verdict.text).toContain('40 of 52');
	});

	test('a dominant cluster reads as focused', () => {
		const verdict = describeArtist(summarizeDistribution([80, 10, 10], 52), options);
		expect(verdict.label).toBe('Focused');
		expect(verdict.text).toContain('80%');
	});

	test('a broad but lopsided artist is versatile or scattered', () => {
		const verdict = describeArtist(summarizeDistribution([40, 30, 25, 5], 52), {
			dominantName: 'Big-Hooked Anthemic Pop-Rock',
			totalClusters: 52
		});
		expect(['Versatile', 'Scattered']).toContain(verdict.label);
	});
});
