const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT, 10) || 12000,
    host: '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
    allowedHosts: true,
    cors: {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }
  },

  // AI Model Configuration
  models: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    models: {
      modelA: process.env.MODEL_A || 'tngtech/deepseek-r1t2-chimera:free',
      modelB: process.env.MODEL_B || 'deepseek/deepseek-r1-0528-qwen3-8b:free',
      modelC: process.env.MODEL_C || 'mistralai/mistral-small-3.2-24b-instruct:free',
      modelD: process.env.MODEL_D || 'moonshotai/kimi-dev-72b:free'
    },
    timeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    maxTokens: 2048,
    temperature: 0.7
  },

  // Database Configuration
  database: {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      ttl: 3600, // 1 hour default TTL
      maxRetries: 3
    },
    mongodb: {
      url: process.env.MONGODB_URL || 'mongodb://localhost:27017/enhanced-ai-pipeline',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      }
    }
  },

  // Queue Configuration
  queue: {
    redis: {
      url: process.env.REDIS_QUEUE_URL || 'redis://localhost:6379'
    },
    concurrency: 5,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  },

  // Security Configuration
  security: {
    jwt: {
      secret: process.env.JWT_SECRET || 'change-this-in-production',
      expiresIn: '24h'
    },
    bcrypt: {
      rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
    }
  },

  // External APIs
  externalApis: {
    factCheck: {
      apiKey: process.env.FACT_CHECK_API_KEY,
      baseUrl: 'https://factchecktools.googleapis.com/v1alpha1'
    },
    wikipedia: {
      baseUrl: process.env.WIKIPEDIA_API_URL || 'https://en.wikipedia.org/api/rest_v1'
    },
    search: {
      apiKey: process.env.SEARCH_API_KEY,
      baseUrl: 'https://api.bing.microsoft.com/v7.0'
    }
  },

  // Monitoring Configuration
  monitoring: {
    enabled: process.env.ENABLE_METRICS === 'true',
    port: parseInt(process.env.METRICS_PORT, 10) || 9090,
    collectDefaultMetrics: true,
    timeout: 5000
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
    maxSize: '20m',
    maxFiles: '14d',
    format: 'json'
  },

  // ML Configuration
  ml: {
    modelPath: path.join(__dirname, '../models'),
    trainingDataPath: path.join(__dirname, '../data/training'),
    evaluationThreshold: 0.7,
    retrainingInterval: 24 * 60 * 60 * 1000, // 24 hours
    features: {
      coherence: { weight: 0.3 },
      accuracy: { weight: 0.4 },
      clarity: { weight: 0.2 },
      bias: { weight: 0.1 }
    }
  },

  // Cache Configuration
  cache: {
    defaultTtl: 3600, // 1 hour
    maxSize: 1000,
    checkPeriod: 600 // 10 minutes
  }
};

// Validation
function validateConfig() {
  const required = [
    'models.apiKey'
  ];

  for (const key of required) {
    const value = key.split('.').reduce((obj, k) => obj && obj[k], config);
    if (!value) {
      throw new Error(`Missing required configuration: ${key}`);
    }
  }
}

// Only validate in production
if (config.server.env === 'production') {
  validateConfig();
}

module.exports = config;