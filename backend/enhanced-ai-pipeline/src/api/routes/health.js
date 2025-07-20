const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const databaseManager = require('../../utils/database');
const queueManager = require('../../utils/queueManager');

// GET /api/v1/health - Health check endpoint
router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    // Check database health
    const dbHealth = await databaseManager.healthCheck();
    health.database = dbHealth;
    
    // Check queue health
    const queueHealth = await queueManager.healthCheck();
    health.queues = queueHealth;
    
    // Determine overall health status
    const isRedisHealthy = dbHealth.redis;
    const isQueueHealthy = queueHealth.initialized;
    
    // MongoDB is optional, so only check Redis and queues for critical health
    if (!isRedisHealthy || !isQueueHealthy) {
      health.status = 'unhealthy';
    } else if (!dbHealth.mongodb) {
      health.status = 'degraded';
    }
    
    health.responseTime = Date.now() - startTime;
    
    // Return 200 for both healthy and degraded, 503 only for unhealthy
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
    
  } catch (error) {
    logger.logError(error, {
      component: 'healthRoutes',
      operation: 'healthCheck',
      requestId: req.requestId
    });
    
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    });
  }
});

// GET /api/v1/health/ready - Readiness probe
router.get('/ready', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check if all critical services are ready
    const dbHealth = await databaseManager.healthCheck();
    const queueHealth = await queueManager.healthCheck();
    
    const isReady = dbHealth.redis && dbHealth.mongodb && queueHealth.initialized;
    
    const response = {
      ready: isReady,
      checks: {
        database: {
          redis: dbHealth.redis,
          mongodb: dbHealth.mongodb
        },
        queues: {
          initialized: queueHealth.initialized
        }
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'healthRoutes',
      operation: 'readinessCheck',
      requestId: req.requestId
    });
    
    res.status(503).json({
      ready: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    });
  }
});

// GET /api/v1/health/live - Liveness probe
router.get('/live', (req, res) => {
  const startTime = Date.now();
  
  // Simple liveness check - if we can respond, we're alive
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    responseTime: Date.now() - startTime
  });
});

module.exports = router;