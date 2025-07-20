const winston = require('winston');
const path = require('path');
const config = require('../../config/config');

// Ensure logs directory exists
const fs = require('fs');
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: customFormat,
  defaultMeta: { service: 'enhanced-ai-pipeline' },
  transports: [
    // File transport
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    }),
    
    // Error file transport
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      tailable: true
    })
  ]
});

// Add console transport in development
if (config.server.env !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Helper methods for structured logging
logger.logApiCall = (method, url, statusCode, responseTime, userId = null) => {
  logger.info('API Call', {
    type: 'api_call',
    method,
    url,
    statusCode,
    responseTime,
    userId,
    timestamp: new Date().toISOString()
  });
};

logger.logModelCall = (modelId, prompt, response, responseTime, error = null) => {
  logger.info('Model Call', {
    type: 'model_call',
    modelId,
    promptLength: prompt?.length || 0,
    responseLength: response?.length || 0,
    responseTime,
    error: error?.message || null,
    timestamp: new Date().toISOString()
  });
};

logger.logCacheHit = (key, type = 'redis') => {
  logger.debug('Cache Hit', {
    type: 'cache_hit',
    key,
    cacheType: type,
    timestamp: new Date().toISOString()
  });
};

logger.logCacheMiss = (key, type = 'redis') => {
  logger.debug('Cache Miss', {
    type: 'cache_miss',
    key,
    cacheType: type,
    timestamp: new Date().toISOString()
  });
};

logger.logPerformanceMetric = (operation, duration, metadata = {}) => {
  logger.info('Performance Metric', {
    type: 'performance',
    operation,
    duration,
    ...metadata,
    timestamp: new Date().toISOString()
  });
};

logger.logError = (error, context = {}) => {
  logger.error('Application Error', {
    type: 'error',
    message: error.message,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
};

logger.logUserFeedback = (userId, queryId, rating, feedback) => {
  logger.info('User Feedback', {
    type: 'user_feedback',
    userId,
    queryId,
    rating,
    feedback,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;