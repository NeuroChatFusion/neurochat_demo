const Queue = require('bull');
const config = require('../../config/config');
const logger = require('./logger');
const databaseManager = require('./database');
const MultiModelMerge = require('../core/multiModelMerge');
const { MultiAgentReasoning } = require('../agents/multiAgentReasoning');
const { MetaModel, EvaluationMetrics, KnowledgeFusion } = require('../ml/ensembleTechniques');
const { v4: uuidv4 } = require('uuid');

class QueueManager {
  constructor() {
    this.queues = {};
    this.processors = {};
    this.isInitialized = false;
    
    // Initialize components
    this.multiModelMerge = new MultiModelMerge();
    this.multiAgentReasoning = new MultiAgentReasoning();
    this.metaModel = new MetaModel();
    this.evaluationMetrics = new EvaluationMetrics();
    this.knowledgeFusion = new KnowledgeFusion();
  }

  async initialize() {
    try {
      // Initialize ML components
      await this.metaModel.initialize();
      await this.multiModelMerge.initializeModelPerformance();
      
      // Create queues
      this.queues = {
        queryProcessing: new Queue('query processing', config.queue.redis.url, {
          defaultJobOptions: {
            attempts: config.queue.attempts,
            backoff: config.queue.backoff,
            removeOnComplete: 100,
            removeOnFail: 50
          }
        }),
        
        modelTraining: new Queue('model training', config.queue.redis.url, {
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 10,
            removeOnFail: 10
          }
        }),
        
        knowledgeEnhancement: new Queue('knowledge enhancement', config.queue.redis.url, {
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'fixed', delay: 2000 },
            removeOnComplete: 50,
            removeOnFail: 25
          }
        }),
        
        evaluation: new Queue('evaluation', config.queue.redis.url, {
          defaultJobOptions: {
            attempts: 2,
            backoff: { type: 'fixed', delay: 1000 },
            removeOnComplete: 200,
            removeOnFail: 50
          }
        })
      };
      
      // Set up processors
      await this.setupProcessors();
      
      // Set up event listeners
      this.setupEventListeners();
      
      this.isInitialized = true;
      logger.info('Queue manager initialized successfully');
      
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'initialize' });
      throw error;
    }
  }

  async setupProcessors() {
    // Query processing processor
    this.queues.queryProcessing.process('processQuery', config.queue.concurrency, async (job) => {
      return await this.processQueryJob(job);
    });
    
    // Model training processor
    this.queues.modelTraining.process('trainModel', 1, async (job) => {
      return await this.trainModelJob(job);
    });
    
    // Knowledge enhancement processor
    this.queues.knowledgeEnhancement.process('enhanceKnowledge', 3, async (job) => {
      return await this.enhanceKnowledgeJob(job);
    });
    
    // Evaluation processor
    this.queues.evaluation.process('evaluateResponse', 5, async (job) => {
      return await this.evaluateResponseJob(job);
    });
  }

  setupEventListeners() {
    Object.entries(this.queues).forEach(([queueName, queue]) => {
      queue.on('completed', (job, result) => {
        logger.info(`Job completed in ${queueName}`, {
          jobId: job.id,
          jobType: job.name,
          processingTime: Date.now() - job.timestamp,
          result: typeof result === 'object' ? Object.keys(result) : result
        });
      });
      
      queue.on('failed', (job, err) => {
        logger.logError(err, {
          component: 'queueManager',
          queue: queueName,
          jobId: job.id,
          jobType: job.name,
          attempts: job.attemptsMade,
          data: job.data
        });
      });
      
      queue.on('stalled', (job) => {
        logger.warn(`Job stalled in ${queueName}`, {
          jobId: job.id,
          jobType: job.name
        });
      });
    });
  }

  async processQueryJob(job) {
    const { query, options = {}, requestId } = job.data;
    const startTime = Date.now();
    
    try {
      logger.info('Processing query job', { jobId: job.id, requestId, query: query.substring(0, 100) });
      
      // Update job progress
      job.progress(10);
      
      // Step 1: Call models in parallel
      const modelResults = await this.multiModelMerge.callModelsInParallel(query, options);
      job.progress(40);
      
      // Step 2: Multi-agent analysis
      const agentAnalysis = await this.multiAgentReasoning.analyzeContent(
        modelResults.mergedResponse.content,
        { query, ...options }
      );
      job.progress(60);
      
      // Step 3: MetaModel prediction
      const metaPrediction = await this.metaModel.predict(
        modelResults.individualResponses,
        agentAnalysis
      );
      job.progress(80);
      
      // Step 4: Knowledge enhancement (if enabled)
      let knowledgeEnhancement = null;
      if (options.enhanceWithKnowledge !== false) {
        knowledgeEnhancement = await this.knowledgeFusion.enhanceWithExternalKnowledge(
          query,
          modelResults.individualResponses,
          options
        );
      }
      job.progress(90);
      
      // Step 5: Final evaluation
      const evaluation = await this.evaluationMetrics.evaluateResponse(
        modelResults.mergedResponse.content,
        { query, ...options }
      );
      job.progress(100);
      
      const result = {
        requestId,
        queryId: modelResults.queryId,
        query,
        modelResults,
        agentAnalysis,
        metaPrediction,
        knowledgeEnhancement,
        evaluation,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      // Cache the result
      await databaseManager.cacheSet(`result:${requestId}`, result, 3600);
      
      // Schedule evaluation job for continuous learning
      if (options.enableLearning !== false) {
        await this.queues.evaluation.add('evaluateResponse', {
          requestId,
          result,
          query
        }, {
          delay: 1000 // Delay to allow for user feedback
        });
      }
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'processQueryJob', jobId: job.id });
      throw error;
    }
  }

  async trainModelJob(job) {
    const { trainingData, modelType = 'meta' } = job.data;
    const startTime = Date.now();
    
    try {
      logger.info('Processing model training job', { jobId: job.id, modelType, dataSize: trainingData?.length });
      
      job.progress(10);
      
      if (modelType === 'meta') {
        // Add training examples to MetaModel
        for (const example of trainingData) {
          await this.metaModel.addTrainingExample(
            example.responses,
            example.qualityAnalysis,
            example.userFeedback
          );
          
          job.progress(10 + (trainingData.indexOf(example) / trainingData.length) * 80);
        }
        
        // Trigger retraining
        await this.metaModel.retrain();
        job.progress(100);
        
        return {
          modelType,
          trainingExamples: trainingData.length,
          newWeights: this.metaModel.getModelStats().weights,
          processingTime: Date.now() - startTime
        };
      }
      
      throw new Error(`Unknown model type: ${modelType}`);
      
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'trainModelJob', jobId: job.id });
      throw error;
    }
  }

  async enhanceKnowledgeJob(job) {
    const { query, responses, options = {} } = job.data;
    const startTime = Date.now();
    
    try {
      logger.info('Processing knowledge enhancement job', { jobId: job.id, query: query.substring(0, 100) });
      
      job.progress(20);
      
      const enhancement = await this.knowledgeFusion.enhanceWithExternalKnowledge(
        query,
        responses,
        options
      );
      
      job.progress(100);
      
      return {
        ...enhancement,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'enhanceKnowledgeJob', jobId: job.id });
      throw error;
    }
  }

  async evaluateResponseJob(job) {
    const { requestId, result, query } = job.data;
    const startTime = Date.now();
    
    try {
      logger.info('Processing evaluation job', { jobId: job.id, requestId });
      
      job.progress(20);
      
      // Check for user feedback
      const userFeedback = await databaseManager.cacheGet(`feedback:${requestId}`);
      
      if (userFeedback) {
        // Add to training data if feedback is available
        const trainingExample = {
          responses: result.modelResults.individualResponses,
          qualityAnalysis: result.agentAnalysis,
          userFeedback,
          query,
          timestamp: new Date().toISOString()
        };
        
        // Schedule training job
        await this.queues.modelTraining.add('trainModel', {
          trainingData: [trainingExample],
          modelType: 'meta'
        });
        
        job.progress(60);
      }
      
      // Perform additional evaluation metrics
      const detailedEvaluation = await this.evaluationMetrics.evaluateResponse(
        result.modelResults.mergedResponse.content,
        { query, userFeedback }
      );
      
      job.progress(80);
      
      // Store evaluation results
      await databaseManager.cacheSet(
        `evaluation:${requestId}`,
        detailedEvaluation,
        86400 // 24 hours
      );
      
      job.progress(100);
      
      return {
        requestId,
        evaluation: detailedEvaluation,
        userFeedbackReceived: !!userFeedback,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'evaluateResponseJob', jobId: job.id });
      throw error;
    }
  }

  // Public API methods
  async addQueryJob(query, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Queue manager not initialized');
    }
    
    const requestId = uuidv4();
    const priority = options.priority || 0;
    
    const job = await this.queues.queryProcessing.add('processQuery', {
      query,
      options,
      requestId
    }, {
      priority,
      delay: options.delay || 0
    });
    
    logger.info('Query job added to queue', {
      jobId: job.id,
      requestId,
      priority,
      query: query.substring(0, 100)
    });
    
    return {
      jobId: job.id,
      requestId,
      estimatedWaitTime: await this.getEstimatedWaitTime('queryProcessing')
    };
  }

  async addTrainingJob(trainingData, modelType = 'meta') {
    if (!this.isInitialized) {
      throw new Error('Queue manager not initialized');
    }
    
    const job = await this.queues.modelTraining.add('trainModel', {
      trainingData,
      modelType
    }, {
      priority: 5 // Higher priority for training
    });
    
    logger.info('Training job added to queue', {
      jobId: job.id,
      modelType,
      dataSize: trainingData.length
    });
    
    return { jobId: job.id };
  }

  async addKnowledgeEnhancementJob(query, responses, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Queue manager not initialized');
    }
    
    const job = await this.queues.knowledgeEnhancement.add('enhanceKnowledge', {
      query,
      responses,
      options
    });
    
    return { jobId: job.id };
  }

  async getJobStatus(jobId, queueName = 'queryProcessing') {
    if (!this.queues[queueName]) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    const job = await this.queues[queueName].getJob(jobId);
    
    if (!job) {
      return { status: 'not_found' };
    }
    
    const state = await job.getState();
    
    return {
      id: job.id,
      status: state,
      progress: job.progress(),
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      attempts: job.attemptsMade
    };
  }

  async getQueueStats() {
    const stats = {};
    
    for (const [queueName, queue] of Object.entries(this.queues)) {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed()
      ]);
      
      stats[queueName] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length + completed.length + failed.length
      };
    }
    
    return stats;
  }

  async getEstimatedWaitTime(queueName) {
    if (!this.queues[queueName]) {
      return 0;
    }
    
    const [waiting, active] = await Promise.all([
      this.queues[queueName].getWaiting(),
      this.queues[queueName].getActive()
    ]);
    
    // Simple estimation: assume 30 seconds per job
    const avgProcessingTime = 30000;
    const queuePosition = waiting.length;
    const activeJobs = active.length;
    
    return (queuePosition + activeJobs) * avgProcessingTime / config.queue.concurrency;
  }

  async pauseQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await this.queues[queueName].pause();
    logger.info(`Queue ${queueName} paused`);
  }

  async resumeQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await this.queues[queueName].resume();
    logger.info(`Queue ${queueName} resumed`);
  }

  async clearQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    await this.queues[queueName].empty();
    logger.info(`Queue ${queueName} cleared`);
  }

  async close() {
    try {
      await Promise.all(
        Object.values(this.queues).map(queue => queue.close())
      );
      logger.info('All queues closed');
    } catch (error) {
      logger.logError(error, { component: 'queueManager', operation: 'close' });
    }
  }

  // Health check
  async healthCheck() {
    const health = {
      initialized: this.isInitialized,
      queues: {},
      timestamp: new Date().toISOString()
    };
    
    for (const [queueName, queue] of Object.entries(this.queues)) {
      try {
        const stats = await queue.getJobCounts();
        health.queues[queueName] = {
          healthy: true,
          ...stats
        };
      } catch (error) {
        health.queues[queueName] = {
          healthy: false,
          error: error.message
        };
      }
    }
    
    return health;
  }
}

// Create singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;