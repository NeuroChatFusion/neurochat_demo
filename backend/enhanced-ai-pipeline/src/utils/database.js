const redis = require('redis');
const mongoose = require('mongoose');
const config = require('../../config/config');
const logger = require('./logger');

class DatabaseManager {
  constructor() {
    this.redisClient = null;
    this.mongoConnection = null;
  }

  // Redis Connection
  async connectRedis() {
    try {
      this.redisClient = redis.createClient({
        url: config.database.redis.url,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server connection refused');
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Retry time exhausted');
          }
          if (options.attempt > config.database.redis.maxRetries) {
            logger.error('Redis max retries exceeded');
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.redisClient.on('error', (err) => {
        logger.logError(err, { component: 'redis' });
      });

      this.redisClient.on('connect', () => {
        logger.info('Redis connected successfully');
      });

      this.redisClient.on('ready', () => {
        logger.info('Redis ready for operations');
      });

      this.redisClient.on('end', () => {
        logger.warn('Redis connection ended');
      });

      await this.redisClient.connect();
      return this.redisClient;
    } catch (error) {
      logger.logError(error, { component: 'redis', operation: 'connect' });
      throw error;
    }
  }

  // MongoDB Connection
  async connectMongoDB() {
    try {
      mongoose.connection.on('connected', () => {
        logger.info('MongoDB connected successfully');
      });

      mongoose.connection.on('error', (err) => {
        logger.logError(err, { component: 'mongodb' });
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      this.mongoConnection = await mongoose.connect(
        config.database.mongodb.url,
        config.database.mongodb.options
      );

      return this.mongoConnection;
    } catch (error) {
      logger.logError(error, { component: 'mongodb', operation: 'connect' });
      throw error;
    }
  }

  // Initialize all database connections
  async initialize() {
    try {
      // Always connect to Redis (required)
      await this.connectRedis();
      
      // Try to connect to MongoDB (optional)
      try {
        await this.connectMongoDB();
        logger.info('MongoDB connected successfully');
      } catch (mongoError) {
        logger.warn('MongoDB connection failed, continuing without MongoDB', {
          error: mongoError.message
        });
      }
      
      logger.info('Database connections initialized');
    } catch (error) {
      logger.logError(error, { component: 'database', operation: 'initialize' });
      throw error;
    }
  }

  // Cache operations
  async cacheGet(key) {
    try {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }
      
      const value = await this.redisClient.get(key);
      if (value) {
        logger.logCacheHit(key);
        return JSON.parse(value);
      } else {
        logger.logCacheMiss(key);
        return null;
      }
    } catch (error) {
      logger.logError(error, { component: 'cache', operation: 'get', key });
      return null;
    }
  }

  async cacheSet(key, value, ttl = config.cache.defaultTtl) {
    try {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }
      
      await this.redisClient.setEx(key, ttl, JSON.stringify(value));
      logger.debug('Cache set', { key, ttl });
    } catch (error) {
      logger.logError(error, { component: 'cache', operation: 'set', key });
    }
  }

  async cacheDelete(key) {
    try {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }
      
      await this.redisClient.del(key);
      logger.debug('Cache deleted', { key });
    } catch (error) {
      logger.logError(error, { component: 'cache', operation: 'delete', key });
    }
  }

  async cacheFlush() {
    try {
      if (!this.redisClient) {
        throw new Error('Redis client not initialized');
      }
      
      await this.redisClient.flushAll();
      logger.info('Cache flushed');
    } catch (error) {
      logger.logError(error, { component: 'cache', operation: 'flush' });
    }
  }

  // Health check
  async healthCheck() {
    const health = {
      redis: false,
      mongodb: false,
      timestamp: new Date().toISOString()
    };

    try {
      // Check Redis
      if (this.redisClient) {
        await this.redisClient.ping();
        health.redis = true;
      }
    } catch (error) {
      logger.logError(error, { component: 'health-check', service: 'redis' });
    }

    try {
      // Check MongoDB
      if (mongoose.connection.readyState === 1) {
        health.mongodb = true;
      }
    } catch (error) {
      logger.logError(error, { component: 'health-check', service: 'mongodb' });
    }

    return health;
  }

  // Graceful shutdown
  async close() {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
        logger.info('Redis connection closed');
      }
      
      if (this.mongoConnection) {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');
      }
    } catch (error) {
      logger.logError(error, { component: 'database', operation: 'close' });
    }
  }
}

// Create singleton instance
const databaseManager = new DatabaseManager();

module.exports = databaseManager;