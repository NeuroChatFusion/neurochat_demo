const express = require('express');
const Joi = require('joi');
const router = express.Router();
const logger = require('../../utils/logger');
const { EvaluationMetrics } = require('../../ml/ensembleTechniques');
const { MultiAgentReasoning } = require('../../agents/multiAgentReasoning');

// Initialize components
const evaluationMetrics = new EvaluationMetrics();
const multiAgentReasoning = new MultiAgentReasoning();

// Validation schemas
const evaluationSchema = Joi.object({
  content: Joi.string().min(1).max(10000).required(),
  context: Joi.object({
    query: Joi.string().max(1000),
    expectedAnswer: Joi.string().max(5000),
    domain: Joi.string().max(100),
    language: Joi.string().max(10).default('en')
  }).default({})
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

// POST /api/v1/evaluation/response - Evaluate a response
router.post('/response', validateInput(evaluationSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { content, context } = req.validatedBody;
    
    logger.info('Response evaluation requested', {
      requestId: req.requestId,
      contentLength: content.length,
      hasContext: Object.keys(context).length > 0
    });
    
    // Perform evaluation
    const evaluation = await evaluationMetrics.evaluateResponse(content, context);
    
    const response = {
      success: true,
      evaluation: {
        overall: evaluation.overallScore,
        metrics: evaluation.metrics,
        recommendations: evaluation.recommendations,
        evaluationId: evaluation.evaluationId
      },
      metadata: {
        contentLength: content.length,
        contextProvided: Object.keys(context).length > 0,
        processingTime: evaluation.responseTime
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'evaluationRoutes',
      operation: 'evaluateResponse',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to evaluate response',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/v1/evaluation/analyze - Comprehensive content analysis
router.post('/analyze', validateInput(evaluationSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { content, context } = req.validatedBody;
    
    logger.info('Content analysis requested', {
      requestId: req.requestId,
      contentLength: content.length
    });
    
    // Perform multi-agent analysis
    const analysis = await multiAgentReasoning.analyzeContent(content, context);
    
    const response = {
      success: true,
      analysis: {
        qualityScore: analysis.qualityScore,
        factCheck: {
          verified: analysis.factCheck.verified,
          confidence: analysis.factCheck.confidence,
          claims: analysis.factCheck.claims?.length || 0,
          sources: analysis.factCheck.sources?.length || 0
        },
        biasAnalysis: {
          overallScore: analysis.biasAnalysis.overallBiasScore,
          detectedBiases: analysis.biasAnalysis.detectedBiases,
          recommendations: analysis.biasAnalysis.recommendations
        },
        coherenceAnalysis: {
          overallScore: analysis.coherenceAnalysis.overallScore,
          metrics: analysis.coherenceAnalysis.metrics,
          issues: analysis.coherenceAnalysis.issues
        },
        recommendations: analysis.recommendations,
        analysisId: analysis.analysisId
      },
      metadata: {
        contentLength: content.length,
        processingTime: analysis.responseTime
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'evaluationRoutes',
      operation: 'analyzeContent',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to analyze content',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/v1/evaluation/metrics - Get available evaluation metrics
router.get('/metrics', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const response = {
      success: true,
      metrics: {
        accuracy: {
          description: 'Measures factual correctness and reliability',
          weight: 0.3,
          factors: ['uncertainty indicators', 'numerical claims', 'source references']
        },
        coherence: {
          description: 'Evaluates logical flow and topic consistency',
          weight: 0.25,
          factors: ['logical flow', 'topic consistency', 'argument structure', 'clarity']
        },
        clarity: {
          description: 'Assesses readability and comprehensibility',
          weight: 0.2,
          factors: ['sentence length', 'vocabulary complexity', 'passive voice usage']
        },
        completeness: {
          description: 'Determines if response fully addresses the query',
          weight: 0.15,
          factors: ['content length', 'structure elements', 'query addressing']
        },
        relevance: {
          description: 'Measures how well response matches the query intent',
          weight: 0.1,
          factors: ['term overlap', 'semantic relevance', 'direct answering']
        }
      },
      analysis: {
        factChecking: {
          description: 'Verifies factual claims against reliable sources',
          sources: ['Wikipedia', 'Fact-checking APIs', 'Web search']
        },
        biasDetection: {
          description: 'Identifies various types of bias in content',
          types: ['political', 'gender', 'emotional', 'confirmation']
        },
        coherenceAnalysis: {
          description: 'Analyzes content structure and flow',
          aspects: ['logical flow', 'topic consistency', 'argument structure']
        }
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'evaluationRoutes',
      operation: 'getMetrics',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve evaluation metrics',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;