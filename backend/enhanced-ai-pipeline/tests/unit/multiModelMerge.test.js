const MultiModelMerge = require('../../src/core/multiModelMerge');
const config = require('../../config/config');

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/database');
jest.mock('axios');

describe('MultiModelMerge', () => {
  let multiModelMerge;

  beforeEach(() => {
    multiModelMerge = new MultiModelMerge();
  });

  describe('initialization', () => {
    test('should initialize with correct models', () => {
      expect(multiModelMerge.models).toEqual(config.models.models);
      expect(multiModelMerge.apiKey).toBe(config.models.apiKey);
      expect(multiModelMerge.baseUrl).toBe(config.models.baseUrl);
    });

    test('should initialize model performance tracking', async () => {
      await multiModelMerge.initializeModelPerformance();
      expect(multiModelMerge.modelPerformance.size).toBeGreaterThan(0);
    });
  });

  describe('calculateModelWeights', () => {
    test('should calculate weights based on performance', () => {
      // Set up mock performance data
      multiModelMerge.modelPerformance.set('model1', {
        qualityScore: 0.8,
        successRate: 0.9
      });
      multiModelMerge.modelPerformance.set('model2', {
        qualityScore: 0.6,
        successRate: 0.7
      });

      const weights = multiModelMerge.calculateModelWeights();
      
      expect(weights).toBeDefined();
      expect(typeof weights).toBe('object');
      expect(weights['model1']).toBeGreaterThan(weights['model2']);
    });
  });

  describe('assessResponseQuality', () => {
    test('should assess quality correctly for good content', () => {
      const goodContent = 'This is a well-structured response with proper length and coherence. It contains multiple sentences that flow logically.';
      const quality = multiModelMerge.assessResponseQuality(goodContent);
      
      expect(quality).toBeGreaterThan(0.5);
      expect(quality).toBeLessThanOrEqual(1.0);
    });

    test('should assess quality correctly for poor content', () => {
      const poorContent = 'Short.';
      const quality = multiModelMerge.assessResponseQuality(poorContent);
      
      expect(quality).toBeLessThan(0.7);
    });

    test('should handle empty content', () => {
      const quality = multiModelMerge.assessResponseQuality('');
      expect(quality).toBe(0);
    });
  });

  describe('calculateConsensus', () => {
    test('should calculate consensus for similar responses', () => {
      const responses = [
        { content: 'The sky is blue and beautiful' },
        { content: 'The sky appears blue in color' },
        { content: 'Blue is the color of the sky' }
      ];

      const consensus = multiModelMerge.calculateConsensus(responses);
      expect(consensus).toBeGreaterThan(0);
      expect(consensus).toBeLessThanOrEqual(1);
    });

    test('should return 1.0 for single response', () => {
      const responses = [{ content: 'Single response' }];
      const consensus = multiModelMerge.calculateConsensus(responses);
      expect(consensus).toBe(1.0);
    });
  });
});