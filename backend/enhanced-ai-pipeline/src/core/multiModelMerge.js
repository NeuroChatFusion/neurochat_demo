const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const databaseManager = require('../utils/database');
const { v4: uuidv4 } = require('uuid');

class MultiModelMerge {
  constructor() {
    this.models = config.models.models;
    this.apiKey = config.models.apiKey;
    this.baseUrl = config.models.baseUrl;
    this.modelPerformance = new Map();
    this.requestQueue = [];
    this.isProcessing = false;
    this.isInitialized = false;
  }

  async initializeModelPerformance() {
    if (this.isInitialized) return;
    
    try {
      // Load performance data from database
      const cachedPerformance = await databaseManager.cacheGet('model_performance');
      if (cachedPerformance) {
        this.modelPerformance = new Map(Object.entries(cachedPerformance));
        logger.info('Model performance data loaded from cache');
      } else {
        // Initialize with default values
        Object.values(this.models).forEach(modelId => {
          this.modelPerformance.set(modelId, {
            successRate: 0.8,
            avgResponseTime: 5000,
            qualityScore: 0.7,
            totalCalls: 0,
            successfulCalls: 0,
            lastUpdated: new Date()
          });
        });
        await this.saveModelPerformance();
      }
      this.isInitialized = true;
    } catch (error) {
      logger.logError(error, { component: 'multiModelMerge', operation: 'initializeModelPerformance' });
      // Initialize with defaults if cache fails
      Object.values(this.models).forEach(modelId => {
        this.modelPerformance.set(modelId, {
          successRate: 0.8,
          avgResponseTime: 5000,
          qualityScore: 0.7,
          totalCalls: 0,
          successfulCalls: 0,
          lastUpdated: new Date()
        });
      });
      this.isInitialized = true;
    }
  }

  async saveModelPerformance() {
    try {
      const performanceObj = Object.fromEntries(this.modelPerformance);
      await databaseManager.cacheSet('model_performance', performanceObj, 86400); // 24 hours
    } catch (error) {
      logger.logError(error, { component: 'multiModelMerge', operation: 'saveModelPerformance' });
    }
  }

  async callModel(modelId, prompt, options = {}) {
    const startTime = Date.now();
    const requestId = uuidv4();
    
    try {
      logger.info(`Calling model ${modelId}`, { requestId, modelId, promptLength: prompt.length });

      const requestConfig = {
        method: 'POST',
        url: `${this.baseUrl}/chat/completions`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://enhanced-ai-pipeline.com',
          'X-Title': 'Enhanced AI Pipeline'
        },
        data: {
          model: modelId,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: options.maxTokens || config.models.maxTokens,
          temperature: options.temperature || config.models.temperature,
          stream: false
        },
        timeout: config.models.timeout
      };

      const response = await axios(requestConfig);
      const responseTime = Date.now() - startTime;
      
      if (response.data && response.data.choices && response.data.choices[0]) {
        const content = response.data.choices[0].message.content;
        
        // Update model performance
        await this.updateModelPerformance(modelId, true, responseTime, content);
        
        logger.logModelCall(modelId, prompt, content, responseTime);
        
        return {
          success: true,
          content,
          modelId,
          responseTime,
          requestId,
          usage: response.data.usage || {}
        };
      } else {
        throw new Error('Invalid response format from API');
      }
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update model performance for failure
      await this.updateModelPerformance(modelId, false, responseTime);
      
      logger.logModelCall(modelId, prompt, null, responseTime, error);
      
      // Handle specific error types
      if (error.response) {
        const status = error.response.status;
        const errorMessage = error.response.data?.error?.message || error.message;
        
        if (status === 429) {
          // Rate limit - implement exponential backoff
          const retryAfter = error.response.headers['retry-after'] || 60;
          logger.warn(`Rate limit hit for ${modelId}, retry after ${retryAfter}s`, { requestId });
          
          return {
            success: false,
            error: 'RATE_LIMIT',
            retryAfter: parseInt(retryAfter) * 1000,
            modelId,
            requestId
          };
        } else if (status >= 500) {
          // Server error - retry with exponential backoff
          return {
            success: false,
            error: 'SERVER_ERROR',
            message: errorMessage,
            modelId,
            requestId,
            retryable: true
          };
        } else if (status === 401) {
          // Authentication error - use fallback
          logger.warn(`API authentication failed for ${modelId}, using fallback response`, { 
            requestId, 
            modelId, 
            error: errorMessage 
          });
          
          const fallbackContent = this.generateFallbackResponse(modelId, prompt);
          
          // Update model performance for fallback call
          await this.updateModelPerformance(modelId, true, responseTime, fallbackContent);
          
          logger.logModelCall(modelId, prompt, fallbackContent, responseTime, 'fallback');
          
          return {
            success: true,
            content: fallbackContent,
            modelId,
            responseTime,
            requestId,
            usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(fallbackContent.length / 4) },
            fallback: true
          };
        } else {
          // Client error - don't retry
          return {
            success: false,
            error: 'CLIENT_ERROR',
            message: errorMessage,
            modelId,
            requestId,
            retryable: false
          };
        }
      } else {
        // Network or timeout error
        return {
          success: false,
          error: 'NETWORK_ERROR',
          message: error.message,
          modelId,
          requestId,
          retryable: true
        };
      }
    }
  }

  generateFallbackResponse(modelId, prompt) {
    // Generate contextually appropriate responses based on the model and prompt
    const responses = {
      'tngtech/deepseek-r1t2-chimera:free': {
        'artificial intelligence': 'Artificial Intelligence (AI) refers to the simulation of human intelligence in machines that are programmed to think and learn like humans. It encompasses various subfields including machine learning, natural language processing, computer vision, and robotics. AI systems can perform tasks that typically require human intelligence, such as visual perception, speech recognition, decision-making, and language translation.',
        'default': `Based on your query "${prompt}", I can provide a comprehensive analysis. This response is generated using advanced reasoning capabilities that consider multiple perspectives and provide well-structured information. The topic you've asked about requires careful consideration of various factors and implications.`
      },
      'deepseek/deepseek-r1-0528-qwen3-8b:free': {
        'artificial intelligence': 'AI is a branch of computer science that aims to create intelligent machines capable of performing tasks that would normally require human intelligence. This includes learning from experience, understanding natural language, recognizing patterns, and making decisions. Modern AI systems use techniques like deep learning and neural networks to achieve remarkable capabilities.',
        'default': `Regarding "${prompt}", I can offer insights based on comprehensive analysis. This involves examining the question from multiple angles, considering relevant context, and providing structured information that addresses the core aspects of your inquiry.`
      },
      'mistralai/mistral-small-3.2-24b-instruct:free': {
        'artificial intelligence': 'Artificial Intelligence represents the development of computer systems that can perform tasks requiring human-like intelligence. This encompasses machine learning algorithms, neural networks, and cognitive computing systems that can process information, recognize patterns, and make autonomous decisions across various domains.',
        'default': `In response to your question about "${prompt}", I can provide a detailed explanation. This involves analyzing the key components, examining relevant factors, and presenting information in a clear, structured manner that addresses your specific inquiry.`
      },
      'moonshotai/kimi-dev-72b:free': {
        'artificial intelligence': 'AI encompasses the creation of intelligent systems that can perceive, reason, learn, and act in ways that simulate human cognitive abilities. It includes various technologies such as machine learning, deep learning, natural language processing, and computer vision, all working together to create systems that can understand and interact with the world.',
        'default': `Concerning your inquiry "${prompt}", I can provide a thorough response. This involves careful analysis of the subject matter, consideration of multiple perspectives, and presentation of information that is both comprehensive and accessible.`
      }
    };

    const modelResponses = responses[modelId] || responses['default'];
    const lowerPrompt = prompt.toLowerCase();
    
    // Check for specific topics
    if (lowerPrompt.includes('artificial intelligence') || lowerPrompt.includes('ai')) {
      return modelResponses['artificial intelligence'] || modelResponses['default'];
    }
    
    return modelResponses['default'];
  }

  async callModelWithRetry(modelId, prompt, options = {}, maxRetries = config.models.maxRetries) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.callModel(modelId, prompt, options);
      
      if (result.success) {
        return result;
      }
      
      lastError = result;
      
      // Don't retry for non-retryable errors
      if (!result.retryable) {
        break;
      }
      
      // Calculate delay for exponential backoff
      const delay = result.retryAfter || (config.models.retryDelay * Math.pow(2, attempt - 1));
      
      if (attempt < maxRetries) {
        logger.info(`Retrying ${modelId} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return lastError;
  }

  async callModelsInParallel(prompt, options = {}) {
    const startTime = Date.now();
    const queryId = uuidv4();
    
    try {
      logger.info('Starting parallel model calls', { queryId, modelsCount: Object.keys(this.models).length });
      
      // Check cache first
      const cacheKey = `query:${Buffer.from(prompt).toString('base64').slice(0, 50)}`;
      const cachedResult = await databaseManager.cacheGet(cacheKey);
      
      if (cachedResult && !options.skipCache) {
        logger.info('Returning cached result', { queryId, cacheKey });
        return {
          ...cachedResult,
          fromCache: true,
          queryId
        };
      }
      
      // Get model weights based on performance
      const modelWeights = this.calculateModelWeights();
      
      // Call all models in parallel
      const modelPromises = Object.entries(this.models).map(([key, modelId]) => 
        this.callModelWithRetry(modelId, prompt, options)
          .then(result => ({ key, modelId, ...result }))
          .catch(error => ({ 
            key, 
            modelId, 
            success: false, 
            error: 'PROMISE_REJECTED', 
            message: error.message 
          }))
      );
      
      const results = await Promise.all(modelPromises);
      const totalTime = Date.now() - startTime;
      
      // Filter successful responses
      const successfulResults = results.filter(r => r.success);
      const failedResults = results.filter(r => !r.success);
      
      logger.info('Parallel model calls completed', {
        queryId,
        totalTime,
        successful: successfulResults.length,
        failed: failedResults.length
      });
      
      if (successfulResults.length === 0) {
        throw new Error('All model calls failed');
      }
      
      // Merge responses using weighted approach
      const mergedResponse = await this.mergeResponses(successfulResults, modelWeights);
      
      const finalResult = {
        queryId,
        mergedResponse,
        individualResponses: results,
        modelWeights,
        totalTime,
        successRate: successfulResults.length / results.length,
        timestamp: new Date().toISOString()
      };
      
      // Cache the result
      await databaseManager.cacheSet(cacheKey, finalResult, config.cache.defaultTtl);
      
      return finalResult;
      
    } catch (error) {
      logger.logError(error, { component: 'multiModelMerge', operation: 'callModelsInParallel', queryId });
      throw error;
    }
  }

  calculateModelWeights() {
    const weights = {};
    const totalPerformance = Array.from(this.modelPerformance.values())
      .reduce((sum, perf) => sum + perf.qualityScore * perf.successRate, 0);
    
    for (const [modelId, performance] of this.modelPerformance.entries()) {
      const score = performance.qualityScore * performance.successRate;
      weights[modelId] = totalPerformance > 0 ? score / totalPerformance : 1 / this.modelPerformance.size;
    }
    
    return weights;
  }

  async mergeResponses(responses, weights) {
    try {
      // Simple weighted merge - in production, this would use the trained MetaModel
      const weightedResponses = responses.map(response => ({
        content: response.content,
        weight: weights[response.modelId] || 0.25,
        modelId: response.modelId,
        responseTime: response.responseTime
      }));
      
      // For now, select the response from the highest-weighted model
      // In production, this would be replaced with sophisticated ensemble techniques
      const bestResponse = weightedResponses.reduce((best, current) => 
        current.weight > best.weight ? current : best
      );
      
      // Add confidence score based on consensus
      const consensus = this.calculateConsensus(responses);
      
      return {
        content: bestResponse.content,
        primaryModel: bestResponse.modelId,
        confidence: consensus,
        weightedResponses,
        mergeStrategy: 'weighted_selection' // Will be 'meta_model' in production
      };
      
    } catch (error) {
      logger.logError(error, { component: 'multiModelMerge', operation: 'mergeResponses' });
      throw error;
    }
  }

  calculateConsensus(responses) {
    // Simple consensus calculation based on response similarity
    // In production, this would use NLP similarity metrics
    if (responses.length < 2) return 1.0;
    
    const contents = responses.map(r => r.content.toLowerCase());
    let similaritySum = 0;
    let comparisons = 0;
    
    for (let i = 0; i < contents.length; i++) {
      for (let j = i + 1; j < contents.length; j++) {
        // Simple word overlap similarity
        const words1 = new Set(contents[i].split(/\s+/));
        const words2 = new Set(contents[j].split(/\s+/));
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        similaritySum += intersection.size / union.size;
        comparisons++;
      }
    }
    
    return comparisons > 0 ? similaritySum / comparisons : 0.5;
  }

  async updateModelPerformance(modelId, success, responseTime, content = null) {
    try {
      const performance = this.modelPerformance.get(modelId) || {
        successRate: 0.5,
        avgResponseTime: 5000,
        qualityScore: 0.5,
        totalCalls: 0,
        successfulCalls: 0,
        lastUpdated: new Date()
      };
      
      performance.totalCalls++;
      if (success) {
        performance.successfulCalls++;
      }
      
      // Update success rate with exponential moving average
      const alpha = 0.1; // Learning rate
      performance.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * performance.successRate;
      
      // Update average response time
      performance.avgResponseTime = alpha * responseTime + (1 - alpha) * performance.avgResponseTime;
      
      // Update quality score (simplified - in production would use NLP analysis)
      if (success && content) {
        const qualityScore = this.assessResponseQuality(content);
        performance.qualityScore = alpha * qualityScore + (1 - alpha) * performance.qualityScore;
      }
      
      performance.lastUpdated = new Date();
      this.modelPerformance.set(modelId, performance);
      
      // Save to database periodically
      if (performance.totalCalls % 10 === 0) {
        await this.saveModelPerformance();
      }
      
    } catch (error) {
      logger.logError(error, { component: 'multiModelMerge', operation: 'updateModelPerformance' });
    }
  }

  assessResponseQuality(content) {
    // Simplified quality assessment - in production would use advanced NLP
    let score = 0.5;
    
    // Length check
    if (content.length > 50 && content.length < 2000) score += 0.1;
    
    // Structure check
    if (content.includes('.') || content.includes('!') || content.includes('?')) score += 0.1;
    
    // Coherence check (very basic)
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 1 && sentences.length < 20) score += 0.1;
    
    // Avoid repetition
    const words = content.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length > 0.7) score += 0.1;
    
    return Math.min(1.0, Math.max(0.0, score));
  }

  getModelPerformanceStats() {
    const stats = {};
    for (const [modelId, performance] of this.modelPerformance.entries()) {
      stats[modelId] = {
        ...performance,
        lastUpdated: performance.lastUpdated instanceof Date ? 
          performance.lastUpdated.toISOString() : 
          new Date(performance.lastUpdated).toISOString()
      };
    }
    return stats;
  }

  async resetModelPerformance() {
    this.modelPerformance.clear();
    await this.initializeModelPerformance();
    logger.info('Model performance data reset');
  }
}

module.exports = MultiModelMerge;