const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/config');
const logger = require('../utils/logger');
const databaseManager = require('../utils/database');
const { v4: uuidv4 } = require('uuid');

class MetaModel {
  constructor() {
    this.modelPath = path.join(config.ml.modelPath, 'meta_model.json');
    this.weights = null;
    this.bias = null;
    this.trainingData = [];
    this.isInitialized = false;
    this.features = config.ml.features;
  }

  async initialize() {
    try {
      // Ensure model directory exists
      await fs.mkdir(config.ml.modelPath, { recursive: true });
      
      // Try to load existing model
      try {
        const modelData = await fs.readFile(this.modelPath, 'utf8');
        const model = JSON.parse(modelData);
        this.weights = model.weights;
        this.bias = model.bias;
        this.isInitialized = true;
        logger.info('MetaModel loaded from disk');
      } catch (error) {
        // Initialize with default weights if no model exists
        await this.initializeDefaultModel();
        logger.info('MetaModel initialized with default weights');
      }
      
      // Load training data
      await this.loadTrainingData();
      
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'initialize' });
      throw error;
    }
  }

  async initializeDefaultModel() {
    // Initialize with equal weights for all models
    this.weights = {
      modelA: 0.25,
      modelB: 0.25,
      modelC: 0.25,
      modelD: 0.25
    };
    
    this.bias = 0.0;
    this.isInitialized = true;
    
    await this.saveModel();
  }

  async saveModel() {
    try {
      const modelData = {
        weights: this.weights,
        bias: this.bias,
        lastUpdated: new Date().toISOString(),
        version: '1.0'
      };
      
      await fs.writeFile(this.modelPath, JSON.stringify(modelData, null, 2));
      logger.info('MetaModel saved to disk');
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'saveModel' });
    }
  }

  async loadTrainingData() {
    try {
      const trainingDataPath = path.join(config.ml.trainingDataPath, 'training_data.json');
      
      try {
        const data = await fs.readFile(trainingDataPath, 'utf8');
        this.trainingData = JSON.parse(data);
        logger.info(`Loaded ${this.trainingData.length} training examples`);
      } catch (error) {
        // Create empty training data file if it doesn't exist
        await fs.mkdir(config.ml.trainingDataPath, { recursive: true });
        this.trainingData = [];
        await this.saveTrainingData();
        logger.info('Created empty training data file');
      }
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'loadTrainingData' });
    }
  }

  async saveTrainingData() {
    try {
      const trainingDataPath = path.join(config.ml.trainingDataPath, 'training_data.json');
      await fs.writeFile(trainingDataPath, JSON.stringify(this.trainingData, null, 2));
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'saveTrainingData' });
    }
  }

  extractFeatures(responses, qualityAnalysis) {
    const features = {};
    
    // Model-specific features
    responses.forEach(response => {
      const modelKey = response.key || response.modelId;
      features[`${modelKey}_response_time`] = response.responseTime || 0;
      features[`${modelKey}_content_length`] = response.content ? response.content.length : 0;
      features[`${modelKey}_success`] = response.success ? 1 : 0;
    });
    
    // Quality features from multi-agent analysis
    if (qualityAnalysis) {
      features.factual_confidence = qualityAnalysis.factCheck?.confidence || 0;
      features.bias_score = qualityAnalysis.biasAnalysis?.overallBiasScore || 0;
      features.coherence_score = qualityAnalysis.coherenceAnalysis?.overallScore || 0;
      features.overall_quality = qualityAnalysis.qualityScore || 0;
    }
    
    // Consensus features
    const successfulResponses = responses.filter(r => r.success);
    features.consensus_count = successfulResponses.length;
    features.consensus_ratio = successfulResponses.length / responses.length;
    
    // Response similarity (simplified)
    if (successfulResponses.length > 1) {
      features.response_similarity = this.calculateResponseSimilarity(successfulResponses);
    } else {
      features.response_similarity = 0;
    }
    
    return features;
  }

  calculateResponseSimilarity(responses) {
    if (responses.length < 2) return 1.0;
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const content1 = responses[i].content?.toLowerCase() || '';
        const content2 = responses[j].content?.toLowerCase() || '';
        
        const words1 = new Set(content1.split(/\s+/));
        const words2 = new Set(content2.split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        const similarity = union.size > 0 ? intersection.size / union.size : 0;
        totalSimilarity += similarity;
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  async predict(responses, qualityAnalysis = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      const features = this.extractFeatures(responses, qualityAnalysis);
      
      // Simple linear combination for now (can be replaced with more complex models)
      let prediction = this.bias;
      
      // Add weighted contributions from each model
      responses.forEach(response => {
        const modelKey = response.key || response.modelId;
        const modelWeight = this.weights[modelKey] || 0.25;
        
        if (response.success) {
          prediction += modelWeight * this.assessResponseQuality(response.content);
        }
      });
      
      // Adjust based on quality features
      if (qualityAnalysis) {
        prediction *= (1 + qualityAnalysis.qualityScore * 0.2); // Boost for high quality
        prediction *= (1 - qualityAnalysis.biasAnalysis?.overallBiasScore * 0.1); // Penalize bias
      }
      
      // Normalize to [0, 1]
      prediction = Math.max(0, Math.min(1, prediction));
      
      return {
        prediction,
        confidence: this.calculatePredictionConfidence(features),
        features,
        modelWeights: this.weights
      };
      
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'predict' });
      return {
        prediction: 0.5,
        confidence: 0.0,
        error: error.message
      };
    }
  }

  assessResponseQuality(content) {
    if (!content) return 0;
    
    let quality = 0.5;
    
    // Length check
    if (content.length > 50 && content.length < 2000) quality += 0.1;
    
    // Structure check
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 1 && sentences.length < 20) quality += 0.1;
    
    // Vocabulary diversity
    const words = content.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length > 0.7) quality += 0.1;
    
    // Coherence indicators
    const coherenceWords = ['therefore', 'however', 'furthermore', 'because', 'since'];
    const hasCoherence = coherenceWords.some(word => content.toLowerCase().includes(word));
    if (hasCoherence) quality += 0.1;
    
    return Math.min(1.0, quality);
  }

  calculatePredictionConfidence(features) {
    // Simple confidence calculation based on feature consistency
    let confidence = 0.5;
    
    // Higher confidence with more successful responses
    confidence += features.consensus_ratio * 0.3;
    
    // Higher confidence with better quality scores
    if (features.overall_quality) {
      confidence += features.overall_quality * 0.2;
    }
    
    // Higher confidence with response similarity
    confidence += features.response_similarity * 0.2;
    
    return Math.min(1.0, confidence);
  }

  async addTrainingExample(responses, qualityAnalysis, userFeedback) {
    try {
      const features = this.extractFeatures(responses, qualityAnalysis);
      
      const trainingExample = {
        id: uuidv4(),
        features,
        target: userFeedback.rating / 5.0, // Normalize to [0, 1]
        responses: responses.map(r => ({
          modelId: r.modelId,
          success: r.success,
          contentLength: r.content?.length || 0,
          responseTime: r.responseTime
        })),
        qualityScores: qualityAnalysis ? {
          factual: qualityAnalysis.factCheck?.confidence,
          bias: qualityAnalysis.biasAnalysis?.overallBiasScore,
          coherence: qualityAnalysis.coherenceAnalysis?.overallScore,
          overall: qualityAnalysis.qualityScore
        } : null,
        userFeedback,
        timestamp: new Date().toISOString()
      };
      
      this.trainingData.push(trainingExample);
      
      // Keep only recent training data (last 1000 examples)
      if (this.trainingData.length > 1000) {
        this.trainingData = this.trainingData.slice(-1000);
      }
      
      await this.saveTrainingData();
      
      logger.info('Training example added', {
        exampleId: trainingExample.id,
        rating: userFeedback.rating,
        totalExamples: this.trainingData.length
      });
      
      // Trigger retraining if we have enough new examples
      if (this.trainingData.length % 50 === 0) {
        await this.retrain();
      }
      
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'addTrainingExample' });
    }
  }

  async retrain() {
    if (this.trainingData.length < 10) {
      logger.info('Not enough training data for retraining');
      return;
    }
    
    try {
      logger.info('Starting MetaModel retraining', { examples: this.trainingData.length });
      
      // Simple gradient descent for linear model
      const learningRate = 0.01;
      const epochs = 100;
      
      // Initialize gradients
      const weightGradients = {};
      Object.keys(this.weights).forEach(key => {
        weightGradients[key] = 0;
      });
      let biasGradient = 0;
      
      for (let epoch = 0; epoch < epochs; epoch++) {
        let totalLoss = 0;
        
        for (const example of this.trainingData) {
          // Forward pass
          let prediction = this.bias;
          
          // Add weighted contributions
          Object.keys(this.weights).forEach(modelKey => {
            const modelFeature = example.features[`${modelKey}_success`] || 0;
            prediction += this.weights[modelKey] * modelFeature;
          });
          
          // Calculate loss (mean squared error)
          const error = prediction - example.target;
          totalLoss += error * error;
          
          // Backward pass - calculate gradients
          biasGradient += error;
          
          Object.keys(this.weights).forEach(modelKey => {
            const modelFeature = example.features[`${modelKey}_success`] || 0;
            weightGradients[modelKey] += error * modelFeature;
          });
        }
        
        // Update weights
        this.bias -= learningRate * biasGradient / this.trainingData.length;
        
        Object.keys(this.weights).forEach(modelKey => {
          this.weights[modelKey] -= learningRate * weightGradients[modelKey] / this.trainingData.length;
        });
        
        // Reset gradients
        Object.keys(weightGradients).forEach(key => {
          weightGradients[key] = 0;
        });
        biasGradient = 0;
        
        // Log progress
        if (epoch % 20 === 0) {
          const avgLoss = totalLoss / this.trainingData.length;
          logger.debug(`Epoch ${epoch}, Average Loss: ${avgLoss.toFixed(4)}`);
        }
      }
      
      // Normalize weights to sum to 1
      const weightSum = Object.values(this.weights).reduce((sum, w) => sum + Math.abs(w), 0);
      if (weightSum > 0) {
        Object.keys(this.weights).forEach(key => {
          this.weights[key] = Math.abs(this.weights[key]) / weightSum;
        });
      }
      
      await this.saveModel();
      
      logger.info('MetaModel retraining completed', {
        newWeights: this.weights,
        bias: this.bias,
        trainingExamples: this.trainingData.length
      });
      
    } catch (error) {
      logger.logError(error, { component: 'metaModel', operation: 'retrain' });
    }
  }

  getModelStats() {
    return {
      weights: this.weights,
      bias: this.bias,
      trainingExamples: this.trainingData.length,
      isInitialized: this.isInitialized,
      lastUpdated: new Date().toISOString()
    };
  }
}

class EvaluationMetrics {
  constructor() {
    this.natural = require('natural');
    this.compromise = require('compromise');
  }

  async evaluateResponse(content, context = {}) {
    const evaluationId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting response evaluation', { evaluationId, contentLength: content.length });
      
      const metrics = {
        accuracy: await this.evaluateAccuracy(content, context),
        coherence: await this.evaluateCoherence(content),
        clarity: await this.evaluateClarity(content),
        completeness: await this.evaluateCompleteness(content, context),
        relevance: await this.evaluateRelevance(content, context)
      };
      
      // Calculate weighted overall score
      const weights = {
        accuracy: 0.3,
        coherence: 0.25,
        clarity: 0.2,
        completeness: 0.15,
        relevance: 0.1
      };
      
      const overallScore = Object.keys(metrics).reduce((sum, metric) => {
        return sum + (metrics[metric].score * weights[metric]);
      }, 0);
      
      const result = {
        evaluationId,
        overallScore,
        metrics,
        recommendations: this.generateRecommendations(metrics),
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      logger.info('Response evaluation completed', {
        evaluationId,
        overallScore: result.overallScore,
        responseTime: result.responseTime
      });
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateResponse', evaluationId });
      
      return {
        evaluationId,
        overallScore: 0,
        metrics: {},
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  async evaluateAccuracy(content, context) {
    try {
      // Use NLP to extract factual claims
      const doc = this.compromise(content);
      const facts = doc.facts().out('array');
      
      let accuracyScore = 0.7; // Default neutral score
      const issues = [];
      
      // Check for common accuracy indicators
      const uncertaintyWords = ['might', 'could', 'possibly', 'perhaps', 'maybe'];
      const certaintyWords = ['definitely', 'certainly', 'absolutely', 'clearly'];
      
      const uncertaintyCount = uncertaintyWords.reduce((count, word) => {
        return count + (content.toLowerCase().match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      }, 0);
      
      const certaintyCount = certaintyWords.reduce((count, word) => {
        return count + (content.toLowerCase().match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      }, 0);
      
      // Adjust score based on certainty/uncertainty balance
      if (uncertaintyCount > certaintyCount * 2) {
        accuracyScore -= 0.1;
        issues.push('High uncertainty in statements');
      } else if (certaintyCount > uncertaintyCount * 3) {
        accuracyScore -= 0.05;
        issues.push('Overly certain statements without evidence');
      }
      
      // Check for numerical claims
      const numbers = content.match(/\d+(\.\d+)?%?/g) || [];
      if (numbers.length > 0) {
        accuracyScore += 0.1; // Bonus for specific data
      }
      
      // Check for source references
      const sourceIndicators = ['according to', 'research shows', 'study found', 'data indicates'];
      const hasSourceReferences = sourceIndicators.some(indicator => 
        content.toLowerCase().includes(indicator)
      );
      
      if (hasSourceReferences) {
        accuracyScore += 0.1;
      } else if (facts.length > 2) {
        issues.push('Factual claims without source references');
        accuracyScore -= 0.05;
      }
      
      return {
        score: Math.max(0, Math.min(1, accuracyScore)),
        details: {
          factualClaims: facts.length,
          uncertaintyWords: uncertaintyCount,
          certaintyWords: certaintyCount,
          numericalClaims: numbers.length,
          hasSourceReferences
        },
        issues
      };
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateAccuracy' });
      return { score: 0.5, details: {}, issues: ['Error in accuracy evaluation'] };
    }
  }

  async evaluateCoherence(content) {
    try {
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      if (sentences.length === 0) {
        return { score: 0, details: {}, issues: ['No sentences found'] };
      }
      
      let coherenceScore = 0.5;
      const issues = [];
      
      // Check sentence transitions
      const transitionWords = ['however', 'therefore', 'furthermore', 'moreover', 'consequently'];
      let transitionCount = 0;
      
      sentences.forEach(sentence => {
        if (transitionWords.some(word => sentence.toLowerCase().includes(word))) {
          transitionCount++;
        }
      });
      
      const transitionRatio = transitionCount / Math.max(sentences.length - 1, 1);
      coherenceScore += transitionRatio * 0.2;
      
      // Check topic consistency using TF-IDF
      const tokenizer = new this.natural.WordTokenizer();
      const stemmer = this.natural.PorterStemmer;
      
      const sentenceTokens = sentences.map(sentence => {
        return tokenizer.tokenize(sentence.toLowerCase())
          .map(token => stemmer.stem(token))
          .filter(token => token.length > 2);
      });
      
      // Calculate term frequency
      const termFreq = {};
      sentenceTokens.flat().forEach(term => {
        termFreq[term] = (termFreq[term] || 0) + 1;
      });
      
      // Find common terms
      const commonTerms = Object.keys(termFreq).filter(term => termFreq[term] > 1);
      const topicConsistency = commonTerms.length / Object.keys(termFreq).length;
      
      coherenceScore += topicConsistency * 0.3;
      
      // Check for logical flow
      const logicalConnectors = ['because', 'since', 'as a result', 'due to', 'leads to'];
      const logicalConnections = logicalConnectors.reduce((count, connector) => {
        return count + (content.toLowerCase().match(new RegExp(connector, 'g')) || []).length;
      }, 0);
      
      coherenceScore += Math.min(logicalConnections / sentences.length, 0.2);
      
      // Identify issues
      if (transitionRatio < 0.1) {
        issues.push('Lack of transition words between sentences');
      }
      
      if (topicConsistency < 0.3) {
        issues.push('Low topic consistency across sentences');
      }
      
      if (sentences.length > 20) {
        issues.push('Content may be too long to maintain coherence');
      }
      
      return {
        score: Math.max(0, Math.min(1, coherenceScore)),
        details: {
          sentenceCount: sentences.length,
          transitionRatio,
          topicConsistency,
          logicalConnections,
          commonTerms: commonTerms.length
        },
        issues
      };
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateCoherence' });
      return { score: 0.5, details: {}, issues: ['Error in coherence evaluation'] };
    }
  }

  async evaluateClarity(content) {
    try {
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const words = content.split(/\s+/);
      
      let clarityScore = 0.5;
      const issues = [];
      
      // Average sentence length
      const avgSentenceLength = words.length / sentences.length;
      if (avgSentenceLength > 25) {
        clarityScore -= 0.2;
        issues.push('Sentences are too long on average');
      } else if (avgSentenceLength < 8) {
        clarityScore -= 0.1;
        issues.push('Sentences are too short on average');
      } else {
        clarityScore += 0.1;
      }
      
      // Vocabulary complexity
      const complexWords = words.filter(word => word.length > 12);
      const complexityRatio = complexWords.length / words.length;
      
      if (complexityRatio > 0.1) {
        clarityScore -= 0.1;
        issues.push('High use of complex words');
      }
      
      // Passive voice detection (simplified)
      const passiveIndicators = [' was ', ' were ', ' been ', ' being '];
      const passiveCount = passiveIndicators.reduce((count, indicator) => {
        return count + (content.toLowerCase().match(new RegExp(indicator, 'g')) || []).length;
      }, 0);
      
      const passiveRatio = passiveCount / sentences.length;
      if (passiveRatio > 0.3) {
        clarityScore -= 0.15;
        issues.push('Excessive use of passive voice');
      }
      
      // Readability indicators
      const readabilityWords = ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'you', 'that'];
      const commonWordCount = readabilityWords.reduce((count, word) => {
        return count + (content.toLowerCase().match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      }, 0);
      
      const readabilityRatio = commonWordCount / words.length;
      if (readabilityRatio > 0.3) {
        clarityScore += 0.1;
      }
      
      return {
        score: Math.max(0, Math.min(1, clarityScore)),
        details: {
          avgSentenceLength,
          complexityRatio,
          passiveRatio,
          readabilityRatio,
          wordCount: words.length,
          sentenceCount: sentences.length
        },
        issues
      };
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateClarity' });
      return { score: 0.5, details: {}, issues: ['Error in clarity evaluation'] };
    }
  }

  async evaluateCompleteness(content, context) {
    try {
      let completenessScore = 0.5;
      const issues = [];
      
      // Check content length
      if (content.length < 100) {
        completenessScore -= 0.3;
        issues.push('Response is too brief');
      } else if (content.length > 2000) {
        completenessScore -= 0.1;
        issues.push('Response may be too verbose');
      } else {
        completenessScore += 0.1;
      }
      
      // Check for structure elements
      const hasIntroduction = /^(this|in this|the following|to answer)/i.test(content.trim());
      const hasConclusion = /(in conclusion|therefore|thus|to summarize).*$/i.test(content.trim());
      const hasExamples = /for example|such as|for instance/i.test(content);
      
      if (hasIntroduction) completenessScore += 0.1;
      if (hasConclusion) completenessScore += 0.1;
      if (hasExamples) completenessScore += 0.1;
      
      // Check if query context is addressed
      if (context.query) {
        const queryWords = context.query.toLowerCase().split(/\s+/);
        const contentWords = content.toLowerCase().split(/\s+/);
        
        const addressedWords = queryWords.filter(word => 
          word.length > 3 && contentWords.includes(word)
        );
        
        const addressRatio = addressedWords.length / queryWords.length;
        completenessScore += addressRatio * 0.2;
        
        if (addressRatio < 0.3) {
          issues.push('Response does not adequately address the query');
        }
      }
      
      return {
        score: Math.max(0, Math.min(1, completenessScore)),
        details: {
          contentLength: content.length,
          hasIntroduction,
          hasConclusion,
          hasExamples,
          queryAddressRatio: context.query ? 
            context.query.toLowerCase().split(/\s+/).filter(word => 
              word.length > 3 && content.toLowerCase().includes(word)
            ).length / context.query.split(/\s+/).length : null
        },
        issues
      };
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateCompleteness' });
      return { score: 0.5, details: {}, issues: ['Error in completeness evaluation'] };
    }
  }

  async evaluateRelevance(content, context) {
    try {
      let relevanceScore = 0.7; // Default neutral score
      const issues = [];
      
      if (!context.query) {
        return {
          score: relevanceScore,
          details: { queryProvided: false },
          issues: ['No query provided for relevance evaluation']
        };
      }
      
      // Tokenize and stem query and content
      const tokenizer = new this.natural.WordTokenizer();
      const stemmer = this.natural.PorterStemmer;
      
      const queryTokens = tokenizer.tokenize(context.query.toLowerCase())
        .map(token => stemmer.stem(token))
        .filter(token => token.length > 2);
      
      const contentTokens = tokenizer.tokenize(content.toLowerCase())
        .map(token => stemmer.stem(token))
        .filter(token => token.length > 2);
      
      // Calculate term overlap
      const querySet = new Set(queryTokens);
      const contentSet = new Set(contentTokens);
      
      const intersection = new Set([...querySet].filter(x => contentSet.has(x)));
      const termOverlap = intersection.size / querySet.size;
      
      relevanceScore += termOverlap * 0.3;
      
      // Check for semantic relevance using word co-occurrence
      const cooccurrenceScore = this.calculateCooccurrence(queryTokens, contentTokens);
      relevanceScore += cooccurrenceScore * 0.2;
      
      // Penalize off-topic content
      if (termOverlap < 0.2) {
        issues.push('Low term overlap with query');
        relevanceScore -= 0.2;
      }
      
      // Check for direct question answering
      if (context.query.includes('?')) {
        const hasDirectAnswer = /^(yes|no|the answer is|it is|this is)/i.test(content.trim());
        if (hasDirectAnswer) {
          relevanceScore += 0.1;
        }
      }
      
      return {
        score: Math.max(0, Math.min(1, relevanceScore)),
        details: {
          termOverlap,
          cooccurrenceScore,
          queryTokens: queryTokens.length,
          contentTokens: contentTokens.length,
          sharedTerms: intersection.size
        },
        issues
      };
      
    } catch (error) {
      logger.logError(error, { component: 'evaluationMetrics', operation: 'evaluateRelevance' });
      return { score: 0.5, details: {}, issues: ['Error in relevance evaluation'] };
    }
  }

  calculateCooccurrence(queryTokens, contentTokens) {
    // Simple co-occurrence calculation
    let cooccurrenceScore = 0;
    const windowSize = 5;
    
    queryTokens.forEach(queryToken => {
      for (let i = 0; i < contentTokens.length; i++) {
        if (contentTokens[i] === queryToken) {
          // Check surrounding words
          const start = Math.max(0, i - windowSize);
          const end = Math.min(contentTokens.length, i + windowSize);
          const window = contentTokens.slice(start, end);
          
          const windowOverlap = queryTokens.filter(token => window.includes(token)).length;
          cooccurrenceScore += windowOverlap / queryTokens.length;
        }
      }
    });
    
    return Math.min(1, cooccurrenceScore / queryTokens.length);
  }

  generateRecommendations(metrics) {
    const recommendations = [];
    
    Object.keys(metrics).forEach(metricName => {
      const metric = metrics[metricName];
      
      if (metric.score < 0.6 && metric.issues) {
        metric.issues.forEach(issue => {
          recommendations.push({
            metric: metricName,
            issue,
            priority: metric.score < 0.4 ? 'high' : 'medium'
          });
        });
      }
    });
    
    return recommendations;
  }
}

class KnowledgeFusion {
  constructor() {
    this.searchApiKey = config.externalApis.search.apiKey;
    this.searchBaseUrl = config.externalApis.search.baseUrl;
    this.wikipediaUrl = config.externalApis.wikipedia.baseUrl;
    this.knowledgeCache = new Map();
  }

  async enhanceWithExternalKnowledge(query, responses, options = {}) {
    const enhancementId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting knowledge enhancement', { enhancementId, query: query.substring(0, 100) });
      
      // Extract key concepts from query and responses
      const keyConcepts = this.extractKeyConcepts(query, responses);
      
      if (keyConcepts.length === 0) {
        return {
          enhancementId,
          enhancedResponses: responses,
          externalKnowledge: [],
          responseTime: Date.now() - startTime
        };
      }
      
      // Search for external knowledge
      const knowledgeSources = await Promise.all([
        this.searchWikipedia(keyConcepts.slice(0, 3)),
        this.searchWeb(keyConcepts.slice(0, 2))
      ]);
      
      const externalKnowledge = knowledgeSources.flat().filter(Boolean);
      
      // Enhance responses with external knowledge
      const enhancedResponses = await this.integrateKnowledge(responses, externalKnowledge);
      
      const result = {
        enhancementId,
        enhancedResponses,
        externalKnowledge,
        keyConcepts,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      logger.info('Knowledge enhancement completed', {
        enhancementId,
        knowledgeSourcesFound: externalKnowledge.length,
        responseTime: result.responseTime
      });
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'knowledgeFusion', operation: 'enhanceWithExternalKnowledge', enhancementId });
      
      return {
        enhancementId,
        enhancedResponses: responses,
        externalKnowledge: [],
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  extractKeyConcepts(query, responses) {
    const tokenizer = new (require('natural')).WordTokenizer();
    const stemmer = require('natural').PorterStemmer;
    
    // Combine query and response content
    const allText = [query, ...responses.map(r => r.content || '')].join(' ');
    
    // Tokenize and filter
    const tokens = tokenizer.tokenize(allText.toLowerCase())
      .map(token => stemmer.stem(token))
      .filter(token => token.length > 3);
    
    // Calculate term frequency
    const termFreq = {};
    tokens.forEach(token => {
      termFreq[token] = (termFreq[token] || 0) + 1;
    });
    
    // Get top terms
    const sortedTerms = Object.entries(termFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([term]) => term);
    
    return sortedTerms;
  }

  async searchWikipedia(concepts) {
    const results = [];
    
    for (const concept of concepts) {
      try {
        // Check cache first
        const cacheKey = `wiki:${concept}`;
        const cached = this.knowledgeCache.get(cacheKey);
        
        if (cached) {
          results.push(cached);
          continue;
        }
        
        const searchUrl = `${this.wikipediaUrl}/page/summary/${encodeURIComponent(concept)}`;
        const response = await axios.get(searchUrl, { timeout: 5000 });
        
        if (response.data && response.data.extract) {
          const knowledge = {
            source: 'wikipedia',
            concept,
            title: response.data.title,
            extract: response.data.extract,
            url: response.data.content_urls?.desktop?.page,
            confidence: 0.8
          };
          
          this.knowledgeCache.set(cacheKey, knowledge);
          results.push(knowledge);
        }
        
      } catch (error) {
        if (error.response?.status !== 404) {
          logger.logError(error, { component: 'knowledgeFusion', operation: 'searchWikipedia', concept });
        }
      }
    }
    
    return results;
  }

  async searchWeb(concepts) {
    if (!this.searchApiKey) {
      return [];
    }
    
    const results = [];
    
    for (const concept of concepts) {
      try {
        const cacheKey = `web:${concept}`;
        const cached = this.knowledgeCache.get(cacheKey);
        
        if (cached) {
          results.push(cached);
          continue;
        }
        
        const searchUrl = `${this.searchBaseUrl}/search`;
        const response = await axios.get(searchUrl, {
          params: {
            q: concept,
            count: 3,
            offset: 0
          },
          headers: {
            'Ocp-Apim-Subscription-Key': this.searchApiKey
          },
          timeout: 10000
        });
        
        if (response.data && response.data.webPages && response.data.webPages.value) {
          const webResults = response.data.webPages.value.slice(0, 2).map(result => ({
            source: 'web',
            concept,
            title: result.name,
            extract: result.snippet,
            url: result.url,
            confidence: 0.6
          }));
          
          webResults.forEach(result => {
            this.knowledgeCache.set(`web:${concept}:${result.url}`, result);
            results.push(result);
          });
        }
        
      } catch (error) {
        logger.logError(error, { component: 'knowledgeFusion', operation: 'searchWeb', concept });
      }
    }
    
    return results;
  }

  async integrateKnowledge(responses, externalKnowledge) {
    if (externalKnowledge.length === 0) {
      return responses;
    }
    
    return responses.map(response => {
      if (!response.success || !response.content) {
        return response;
      }
      
      // Find relevant knowledge for this response
      const relevantKnowledge = externalKnowledge.filter(knowledge => {
        const responseWords = response.content.toLowerCase().split(/\s+/);
        const knowledgeWords = knowledge.extract.toLowerCase().split(/\s+/);
        
        const overlap = responseWords.filter(word => knowledgeWords.includes(word));
        return overlap.length > 2;
      });
      
      if (relevantKnowledge.length === 0) {
        return response;
      }
      
      // Enhance response with knowledge
      const knowledgeSnippets = relevantKnowledge.map(k => 
        `[Source: ${k.source}] ${k.extract.substring(0, 200)}...`
      );
      
      return {
        ...response,
        enhancedContent: response.content,
        externalKnowledge: relevantKnowledge,
        knowledgeSnippets
      };
    });
  }

  clearCache() {
    this.knowledgeCache.clear();
    logger.info('Knowledge cache cleared');
  }
}

module.exports = {
  MetaModel,
  EvaluationMetrics,
  KnowledgeFusion
};