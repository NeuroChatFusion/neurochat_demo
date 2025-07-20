const express = require('express');
const Joi = require('joi');
const router = express.Router();
const logger = require('../../utils/logger');
const databaseManager = require('../../utils/database');
const queueManager = require('../../utils/queueManager');
const { v4: uuidv4 } = require('uuid');

// Validation schemas
const querySchema = Joi.object({
  query: Joi.string().min(1).max(5000).required(),
  options: Joi.object({
    priority: Joi.number().integer().min(0).max(10).default(0),
    skipCache: Joi.boolean().default(false),
    enhanceWithKnowledge: Joi.boolean().default(true),
    enableLearning: Joi.boolean().default(true),
    maxTokens: Joi.number().integer().min(100).max(4000),
    temperature: Joi.number().min(0).max(2),
    timeout: Joi.number().integer().min(5000).max(60000)
  }).default({})
});

const feedbackSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  feedback: Joi.string().max(1000).optional(),
  aspects: Joi.object({
    accuracy: Joi.number().integer().min(1).max(5),
    clarity: Joi.number().integer().min(1).max(5),
    completeness: Joi.number().integer().min(1).max(5),
    relevance: Joi.number().integer().min(1).max(5)
  }).optional()
});

// Middleware for input validation
const validateInput = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details
      });
    }
    req.validatedBody = value;
    next();
  };
};

// POST /api/v1/queries - Submit a new query
router.post('/', validateInput(querySchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { query, options } = req.validatedBody;
    
    logger.info('New query submitted', {
      requestId: req.requestId,
      queryLength: query.length,
      options
    });
    
    // Add query to processing queue
    const queueResult = await queueManager.addQueryJob(query, {
      ...options,
      requestId: req.requestId
    });
    
    const response = {
      success: true,
      queryId: queueResult.requestId,
      jobId: queueResult.jobId,
      status: 'queued',
      estimatedWaitTime: queueResult.estimatedWaitTime,
      message: 'Query submitted successfully and is being processed',
      links: {
        status: `/api/v1/queries/${queueResult.requestId}/status`,
        result: `/api/v1/queries/${queueResult.requestId}`,
        feedback: `/api/v1/queries/${queueResult.requestId}/feedback`
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.status(202).json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'queryRoutes',
      operation: 'submitQuery',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to submit query for processing',
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/v1/queries/:id - Get query result
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  const queryId = req.params.id;
  
  try {
    logger.info('Query result requested', {
      requestId: req.requestId,
      queryId
    });
    
    // Check if result is available in cache
    const result = await databaseManager.cacheGet(`result:${queryId}`);
    
    if (!result) {
      // Check job status
      const jobStatus = await queueManager.getJobStatus(queryId);
      
      if (jobStatus.status === 'not_found') {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Query not found',
          queryId,
          timestamp: new Date().toISOString()
        });
      }
      
      if (jobStatus.status === 'failed') {
        return res.status(500).json({
          error: 'Processing Failed',
          message: 'Query processing failed',
          queryId,
          reason: jobStatus.failedReason,
          timestamp: new Date().toISOString()
        });
      }
      
      // Still processing
      return res.status(202).json({
        success: false,
        queryId,
        status: jobStatus.status,
        progress: jobStatus.progress,
        message: 'Query is still being processed',
        estimatedCompletion: jobStatus.status === 'active' ? 
          new Date(Date.now() + 30000).toISOString() : null,
        links: {
          status: `/api/v1/queries/${queryId}/status`
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Format response
    const response = {
      success: true,
      queryId,
      query: result.query,
      result: {
        content: result.modelResults.mergedResponse.content,
        confidence: result.metaPrediction.confidence,
        qualityScore: result.evaluation.overallScore,
        sources: result.knowledgeEnhancement?.externalKnowledge || [],
        modelWeights: result.metaPrediction.modelWeights,
        processingTime: result.processingTime
      },
      analysis: {
        factCheck: {
          verified: result.agentAnalysis.factCheck.verified,
          confidence: result.agentAnalysis.factCheck.confidence,
          claims: result.agentAnalysis.factCheck.claims?.length || 0
        },
        bias: {
          score: result.agentAnalysis.biasAnalysis.overallBiasScore,
          detectedBiases: result.agentAnalysis.biasAnalysis.detectedBiases?.length || 0
        },
        coherence: {
          score: result.agentAnalysis.coherenceAnalysis.overallScore,
          issues: result.agentAnalysis.coherenceAnalysis.issues?.length || 0
        }
      },
      evaluation: {
        overall: result.evaluation.overallScore,
        metrics: Object.keys(result.evaluation.metrics || {}).reduce((acc, key) => {
          acc[key] = result.evaluation.metrics[key].score;
          return acc;
        }, {}),
        recommendations: result.evaluation.recommendations?.length || 0
      },
      metadata: {
        timestamp: result.timestamp,
        processingTime: result.processingTime,
        fromCache: result.fromCache || false,
        modelResponses: result.modelResults.individualResponses.length,
        successRate: result.modelResults.successRate
      },
      links: {
        feedback: `/api/v1/queries/${queryId}/feedback`,
        detailed: `/api/v1/queries/${queryId}/detailed`
      },
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'queryRoutes',
      operation: 'getQueryResult',
      requestId: req.requestId,
      queryId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve query result',
      queryId,
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/v1/queries/:id/feedback - Submit user feedback
router.post('/:id/feedback', validateInput(feedbackSchema), async (req, res) => {
  const startTime = Date.now();
  const queryId = req.params.id;
  
  try {
    const { rating, feedback, aspects } = req.validatedBody;
    
    logger.info('User feedback submitted', {
      requestId: req.requestId,
      queryId,
      rating,
      hasTextFeedback: !!feedback,
      hasAspects: !!aspects
    });
    
    // Check if query exists
    const result = await databaseManager.cacheGet(`result:${queryId}`);
    
    if (!result) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Query not found',
        queryId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Store feedback
    const feedbackData = {
      queryId,
      rating,
      feedback,
      aspects,
      userId: req.user?.id || 'anonymous',
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      timestamp: new Date().toISOString()
    };
    
    await databaseManager.cacheSet(`feedback:${queryId}`, feedbackData, 86400 * 7); // 7 days
    
    // Log feedback for analytics
    logger.logUserFeedback(
      feedbackData.userId,
      queryId,
      rating,
      feedback
    );
    
    const response = {
      success: true,
      message: 'Feedback submitted successfully',
      queryId,
      feedbackId: uuidv4(),
      impact: 'Your feedback will help improve future responses',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'queryRoutes',
      operation: 'submitFeedback',
      requestId: req.requestId,
      queryId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to submit feedback',
      queryId,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;