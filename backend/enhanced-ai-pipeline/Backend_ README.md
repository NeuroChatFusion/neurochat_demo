# NeuroChat Fusion Backend: Multi-Model AI Engine

This project is a powerful, production-ready AI engine designed for scalable, high-performance, and reliable processing of complex queries by leveraging multiple AI models and advanced ensemble techniques.

## Key Features:

### 1. Multi-Model Query Processing

Processes single queries across multiple AI models (via OpenRouter/APIs) in parallel to produce robust and accurate answers. `multiModelMerge.js` intelligently synthesizes responses, enhancing accuracy and error resistance.

### 2. Multi-Agent Reasoning: Deep Analysis of Answer Quality

Utilizes specialized AI agents (`multiAgentReasoning.js`) to evaluate and improve answer quality:
*   **Fact-Checking Agent:** Verifies accuracy against external sources.
*   **Bias Detection Agent:** Identifies linguistic, cultural, political, or emotional biases.
*   **Coherence Agent:** Evaluates logical flow and topic consistency.
These agents run in parallel, providing comprehensive quality assessment.

### 3. Asynchronous Processing & Scalability

Uses `Bull` and `Redis` (`queueManager.js`) for asynchronous task processing, preventing server blocking and enabling high concurrency. The system scales horizontally by adding more nodes.

### 4. Production-Ready Features

*   **RESTful API:** Comprehensive API for queries, models, and system health.
*   **Monitoring & Metrics:** Prometheus integration for detailed performance metrics (request duration, queue stats, model performance, error rates).
*   **Logging:** Winston for structured logging of operations, errors, and performance.
*   **Security:** Rate limiting, Joi for input validation, CORS configuration, Helmet for HTTP security headers, and secure environment variable management for API keys.

## Architecture

The backend follows a modular and scalable architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   REST API      │    │   Queue Manager  │    │  Multi-Model    │
│   (Express.js)  │───▶│   (Bull/Redis)   │───▶│     Merge       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ▲                                               │
         │                                               ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Monitoring    │◀───│   Multi-Agent    │◀───│   Knowledge     │
│  (Prometheus)   │    │   Reasoning      │    │    Fusion       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │   MetaModel &    │
                       │   Evaluation     │
                       └──────────────────┘
```

**Key Components:**

*   **REST API (Express.js):** Entry point for HTTP requests, handles routing, validation, and security.
*   **Queue Manager (Bull/Redis):** Manages asynchronous task processing.
*   **Multi-Model Merge:** Routes queries to multiple AI models and merges responses using ensemble techniques.
*   **Multi-Agent Reasoning:** Evaluates and improves answer quality via specialized agents (fact-checking, bias detection, coherence).
*   **Knowledge Fusion:** Integrates external knowledge sources to enrich answers.
*   **MetaModel & Evaluation:** Learns from user feedback to improve response quality.
*   **Monitoring (Prometheus):** Collects and exports system metrics.

## Installation and Setup Guide

### 1. Prerequisites

*   **Node.js:** Version 16+.
*   **npm:** Comes with Node.js.
*   **Redis Server:** For task queue and caching.
*   **MongoDB (Optional):** For persistent data (e.g., conversation logs).

### 2. Project Setup

1.  **Clone/Download:** Obtain project files.
2.  **Install Dependencies:** `npm install` in the project root.
3.  **Configure Environment Variables:** Copy `.env.example` to `.env` and update:
    *   `PORT`: Server port (default: `12000`).
    *   `OPENROUTER_API_KEY`: Your OpenRouter API key.
    *   `REDIS_URL`: Redis connection URL (default: `redis://localhost:6379`).
    *   `MONGODB_URL`: MongoDB connection URL (default: `mongodb://localhost:27017/enhanced-ai-pipeline`).
    *   `LOG_LEVEL`: Logging level.
    *   `CORS_ORIGIN`: Frontend URL for CORS (e.g., `http://localhost:3000`).

### 3. Run Required Services

Ensure Redis and MongoDB (if used) are running:
*   **Redis:** `redis-server`
*   **MongoDB (Optional):** `mongod`

### 4. Run the Application

*   **Development:** `npm run dev`
*   **Production:** `npm start`

Backend will be available on the configured port (default `12000`).

## API Documentation

Base endpoint: `http://localhost:12000/api/v1`

### Core Endpoints

*   **`POST /queries`:** Submit a text query. Returns `queryId` and `jobId`.
*   **`GET /queries/{queryId}`:** Retrieve query result. Returns status and final content upon completion.
*   **`POST /queries/{queryId}/feedback`:** Submit user feedback.
*   **`GET /models/performance`:** Retrieve model performance metrics.
*   **`GET /health`:** Check system health.

All API responses follow a standardized JSON format.

## Core AI Components

*   **Multi-Model Merge (`src/core/multiModelMerge.js`):** Manages parallel calls to LLMs and combines responses.
*   **Multi-Agent Reasoning (`src/agents/multiAgentReasoning.js`):** Contains Fact-Checking, Bias Detection, and Coherence Agents.
*   **MetaModel (`models/meta_model.json`):** Learns from user feedback to improve response quality.
*   **Knowledge Fusion:** Integrates external knowledge sources.

## Monitoring and Logging

*   **Health Endpoints:** `/api/v1/health`, `/api/v1/health/ready`, `/api/v1/health/live`.
*   **Metrics (Prometheus):** Request duration, queue stats, model performance, error rates.
*   **Logging (Winston):** Structured logging for API calls, model performance, cache, user feedback, and error tracing.

## Security

Features include rate limiting, input validation (Joi), CORS, Helmet for HTTP security headers, and secure API key management.

## Testing

*   **Run All Tests:** `npm test`
*   **Code Coverage:** `npm run test:coverage`
*   **Specific Test Suite:** `npm test -- --testPathPattern=multiModelMerge`

## Performance

Optimized for high performance and scalability through parallel processing, Redis caching, a queue system, and connection pooling.

## Deployment

Docker is recommended for production deployment. A `Dockerfile` example is provided. Ensure Redis and MongoDB are running, configure environment variables, and set up monitoring and a reverse proxy.

## Contribution & Support

Contributions are welcome. For issues or questions, open an issue on GitHub or refer to API documentation.

