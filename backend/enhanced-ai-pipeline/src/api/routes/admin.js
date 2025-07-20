const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const databaseManager = require('../../utils/database');
const queueManager = require('../../utils/queueManager');

// GET /api/v1/admin/stats - System statistics
router.get('/stats', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Get queue statistics
    const queueStats = await queueManager.getQueueStats();
    
    // Get system metrics
    const systemStats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    };
    
    const response = {
      success: true,
      system: systemStats,
      queues: queueStats,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'adminRoutes',
      operation: 'getStats',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve system statistics',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/v1/admin/cache/clear - Clear cache
router.post('/cache/clear', async (req, res) => {
  const startTime = Date.now();
  
  try {
    await databaseManager.cacheFlush();
    
    const response = {
      success: true,
      message: 'Cache cleared successfully',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'adminRoutes',
      operation: 'clearCache',
      requestId: req.requestId
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to clear cache',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/v1/admin/queues/:queueName/pause - Pause a queue
router.post('/queues/:queueName/pause', async (req, res) => {
  const startTime = Date.now();
  const queueName = req.params.queueName;
  
  try {
    await queueManager.pauseQueue(queueName);
    
    const response = {
      success: true,
      message: `Queue ${queueName} paused successfully`,
      queueName,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'adminRoutes',
      operation: 'pauseQueue',
      requestId: req.requestId,
      queueName
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: `Failed to pause queue ${queueName}`,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/v1/admin/queues/:queueName/resume - Resume a queue
router.post('/queues/:queueName/resume', async (req, res) => {
  const startTime = Date.now();
  const queueName = req.params.queueName;
  
  try {
    await queueManager.resumeQueue(queueName);
    
    const response = {
      success: true,
      message: `Queue ${queueName} resumed successfully`,
      queueName,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
    
    res.json(response);
    
  } catch (error) {
    logger.logError(error, {
      component: 'adminRoutes',
      operation: 'resumeQueue',
      requestId: req.requestId,
      queueName
    });
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: `Failed to resume queue ${queueName}`,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;