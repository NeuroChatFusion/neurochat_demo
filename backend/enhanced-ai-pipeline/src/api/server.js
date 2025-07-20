const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
// Simple rate limiting without Redis for now
const rateLimit = require('express-rate-limit');
const promBundle = require('express-prom-bundle');
const config = require('../../config/config');
const logger = require('../utils/logger');
const databaseManager = require('../utils/database');
const queueManager = require('../utils/queueManager');

// Import route handlers
const queryRoutes = require('./routes/queries');
const modelRoutes = require('./routes/models');
const evaluationRoutes = require('./routes/evaluation');
const adminRoutes = require('./routes/admin');
const healthRoutes = require('./routes/health');

class Server {
  constructor() {
    this.app = express();
    this.server = null;
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      // Initialize database connections
      await databaseManager.initialize();
      
      // Initialize queue manager
      await queueManager.initialize();
      
      // Setup middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Setup error handling
      this.setupErrorHandling();
      
      logger.info('Server initialized successfully');
      
    } catch (error) {
      logger.logError(error, { component: 'server', operation: 'initialize' });
      throw error;
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    this.app.use(cors(config.server.cors));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimit.windowMs,
      max: config.security.rateLimit.max,
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(config.security.rateLimit.windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path
        });
        res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil(config.security.rateLimit.windowMs / 1000)
        });
      }
    });
    this.app.use(limiter);

    // Metrics middleware
    if (config.monitoring.enabled) {
      const metricsMiddleware = promBundle({
        includeMethod: true,
        includePath: true,
        includeStatusCode: true,
        includeUp: true,
        customLabels: {
          service: 'enhanced-ai-pipeline'
        },
        promClient: {
          collectDefaultMetrics: {}
        }
      });
      this.app.use(metricsMiddleware);
    }

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Serve static files
    this.app.use(express.static(path.join(__dirname, '../../public')));

    // Download endpoint for the production zip file
    this.app.get('/download/production-package', (req, res) => {
      const zipPath = path.join(__dirname, '../../../enhanced-multi-model-ai-pipeline-production.zip');
      const fs = require('fs');
      
      if (fs.existsSync(zipPath)) {
        res.download(zipPath, 'enhanced-multi-model-ai-pipeline-production.zip', (err) => {
          if (err) {
            logger.error('Download error:', err);
            res.status(500).json({ error: 'Download failed' });
          }
        });
      } else {
        res.status(404).json({ error: 'Package not found' });
      }
    });

    // Request logging
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        logger.logApiCall(
          req.method,
          req.originalUrl,
          res.statusCode,
          responseTime,
          req.user?.id
        );
      });
      
      next();
    });

    // Request ID middleware
    this.app.use((req, res, next) => {
      req.requestId = require('uuid').v4();
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/v1/queries', queryRoutes);
    this.app.use('/api/v1/models', modelRoutes);
    this.app.use('/api/v1/evaluation', evaluationRoutes);
    this.app.use('/api/v1/admin', adminRoutes);
    this.app.use('/api/v1/health', healthRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Enhanced Multi-Model AI Pipeline',
        version: '1.0.0',
        status: 'operational',
        timestamp: new Date().toISOString(),
        endpoints: {
          queries: '/api/v1/queries',
          models: '/api/v1/models',
          evaluation: '/api/v1/evaluation',
          admin: '/api/v1/admin',
          health: '/api/v1/health'
        }
      });
    });

    // API documentation
    this.app.get('/api/v1', (req, res) => {
      res.json({
        name: 'Enhanced Multi-Model AI Pipeline API',
        version: '1.0.0',
        description: 'Production-ready multi-model AI pipeline with real API integration',
        endpoints: {
          'POST /api/v1/queries': 'Submit a query for processing',
          'GET /api/v1/queries/:id': 'Get query result',
          'GET /api/v1/queries/:id/status': 'Get query processing status',
          'POST /api/v1/queries/:id/feedback': 'Submit user feedback',
          'GET /api/v1/models/performance': 'Get model performance statistics',
          'GET /api/v1/models/weights': 'Get current model weights',
          'POST /api/v1/evaluation/response': 'Evaluate a response',
          'GET /api/v1/health': 'System health check',
          'GET /api/v1/admin/stats': 'System statistics (admin only)'
        },
        documentation: 'https://github.com/enhanced-ai-pipeline/docs'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((err, req, res, next) => {
      const errorId = require('uuid').v4();
      
      logger.logError(err, {
        component: 'server',
        operation: 'errorHandler',
        errorId,
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // Don't expose internal errors in production
      const isDevelopment = config.server.env === 'development';
      
      let statusCode = 500;
      let message = 'Internal Server Error';
      
      if (err.statusCode) {
        statusCode = err.statusCode;
      }
      
      if (err.message && (isDevelopment || statusCode < 500)) {
        message = err.message;
      }

      res.status(statusCode).json({
        error: statusCode >= 500 ? 'Internal Server Error' : 'Client Error',
        message,
        errorId,
        timestamp: new Date().toISOString(),
        ...(isDevelopment && { stack: err.stack })
      });
    });

    // Unhandled promise rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      logger.logError(new Error('Unhandled Promise Rejection'), {
        component: 'server',
        operation: 'unhandledRejection',
        reason: reason.toString(),
        promise: promise.toString()
      });
    });

    // Uncaught exception handler
    process.on('uncaughtException', (error) => {
      logger.logError(error, {
        component: 'server',
        operation: 'uncaughtException'
      });
      
      // Graceful shutdown on uncaught exception
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });
  }

  async start() {
    try {
      await this.initialize();
      
      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`Server started successfully`, {
          port: config.server.port,
          host: config.server.host,
          env: config.server.env,
          pid: process.pid
        });
        
        console.log(`🚀 Enhanced AI Pipeline Server running at:`);
        console.log(`   Local:   http://localhost:${config.server.port}`);
        console.log(`   Network: http://${config.server.host}:${config.server.port}`);
        console.log(`   Environment: ${config.server.env}`);
        console.log(`   Process ID: ${process.pid}`);
      });

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();
      
    } catch (error) {
      logger.logError(error, { component: 'server', operation: 'start' });
      process.exit(1);
    }
  }

  setupShutdownHandlers() {
    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, starting graceful shutdown');
      this.gracefulShutdown('SIGTERM');
    });

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.info('SIGINT received, starting graceful shutdown');
      this.gracefulShutdown('SIGINT');
    });
  }

  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }
    
    this.isShuttingDown = true;
    logger.info(`Starting graceful shutdown due to ${signal}`);
    
    const shutdownTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000); // 30 second timeout

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Close queue manager
      await queueManager.close();
      
      // Close database connections
      await databaseManager.close();
      
      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);
      
    } catch (error) {
      logger.logError(error, { component: 'server', operation: 'gracefulShutdown' });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  // Health check endpoint
  async getHealthStatus() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0',
      environment: config.server.env
    };

    try {
      // Check database health
      const dbHealth = await databaseManager.healthCheck();
      health.database = dbHealth;
      
      // Check queue health
      const queueHealth = await queueManager.healthCheck();
      health.queues = queueHealth;
      
      // Determine overall health
      const isDbHealthy = dbHealth.redis && dbHealth.mongodb;
      const isQueueHealthy = queueHealth.initialized;
      
      if (!isDbHealthy || !isQueueHealthy) {
        health.status = 'degraded';
      }
      
    } catch (error) {
      health.status = 'unhealthy';
      health.error = error.message;
    }

    return health;
  }
}

// Create and export server instance
const server = new Server();

// Start server if this file is run directly
if (require.main === module) {
  server.start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = server;