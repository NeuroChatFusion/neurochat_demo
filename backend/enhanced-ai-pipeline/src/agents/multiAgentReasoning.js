const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/logger');
const databaseManager = require('../utils/database');
const { v4: uuidv4 } = require('uuid');

class FactCheckingAgent {
  constructor() {
    this.apiKey = config.externalApis.factCheck.apiKey;
    this.baseUrl = config.externalApis.factCheck.baseUrl;
    this.wikipediaUrl = config.externalApis.wikipedia.baseUrl;
  }

  async verifyFacts(content, context = {}) {
    const verificationId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting fact verification', { verificationId, contentLength: content.length });
      
      // Extract claims from content
      const claims = this.extractClaims(content);
      
      if (claims.length === 0) {
        return {
          verificationId,
          verified: true,
          confidence: 0.8,
          claims: [],
          sources: [],
          responseTime: Date.now() - startTime
        };
      }
      
      // Verify each claim
      const verificationPromises = claims.map(claim => this.verifyClaim(claim));
      const verificationResults = await Promise.all(verificationPromises);
      
      // Calculate overall verification score
      const verifiedClaims = verificationResults.filter(r => r.verified);
      const overallConfidence = verifiedClaims.length / verificationResults.length;
      
      const result = {
        verificationId,
        verified: overallConfidence >= 0.7,
        confidence: overallConfidence,
        claims: verificationResults,
        sources: this.aggregateSources(verificationResults),
        responseTime: Date.now() - startTime
      };
      
      logger.info('Fact verification completed', {
        verificationId,
        verified: result.verified,
        confidence: result.confidence,
        claimsCount: claims.length
      });
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'factCheckingAgent', operation: 'verifyFacts', verificationId });
      
      return {
        verificationId,
        verified: false,
        confidence: 0.0,
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  extractClaims(content) {
    // Simple claim extraction - in production would use NLP
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // Filter for factual claims (sentences with numbers, dates, names, etc.)
    const factualClaims = sentences.filter(sentence => {
      const s = sentence.toLowerCase();
      return (
        /\d{4}/.test(s) || // Years
        /\d+%/.test(s) || // Percentages
        /\$\d+/.test(s) || // Money
        /\b(according to|research shows|study found|data indicates)\b/.test(s) || // Research claims
        /\b(president|ceo|director|minister)\b/.test(s) || // Titles
        /\b(company|organization|university|government)\b/.test(s) // Institutions
      );
    });
    
    return factualClaims.slice(0, 5); // Limit to 5 claims to avoid API limits
  }

  async verifyClaim(claim) {
    try {
      // Try multiple verification sources
      const verificationSources = [
        this.verifyWithWikipedia(claim),
        this.verifyWithFactCheckAPI(claim)
      ];
      
      const results = await Promise.allSettled(verificationSources);
      const successfulResults = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
      
      if (successfulResults.length === 0) {
        return {
          claim,
          verified: false,
          confidence: 0.0,
          sources: [],
          error: 'No verification sources available'
        };
      }
      
      // Aggregate results
      const avgConfidence = successfulResults.reduce((sum, r) => sum + r.confidence, 0) / successfulResults.length;
      const sources = successfulResults.flatMap(r => r.sources);
      
      return {
        claim,
        verified: avgConfidence >= 0.6,
        confidence: avgConfidence,
        sources,
        details: successfulResults
      };
      
    } catch (error) {
      logger.logError(error, { component: 'factCheckingAgent', operation: 'verifyClaim', claim });
      
      return {
        claim,
        verified: false,
        confidence: 0.0,
        sources: [],
        error: error.message
      };
    }
  }

  async verifyWithWikipedia(claim) {
    try {
      // Extract key terms for search
      const searchTerms = this.extractKeyTerms(claim);
      
      if (searchTerms.length === 0) {
        return { confidence: 0.0, sources: [] };
      }
      
      // Search Wikipedia
      const searchUrl = `${this.wikipediaUrl}/page/summary/${encodeURIComponent(searchTerms[0])}`;
      const response = await axios.get(searchUrl, { timeout: 5000 });
      
      if (response.data && response.data.extract) {
        const extract = response.data.extract.toLowerCase();
        const claimLower = claim.toLowerCase();
        
        // Simple similarity check
        const similarity = this.calculateTextSimilarity(extract, claimLower);
        
        return {
          confidence: similarity,
          sources: [{
            type: 'wikipedia',
            title: response.data.title,
            url: response.data.content_urls?.desktop?.page,
            extract: response.data.extract.substring(0, 200) + '...',
            similarity
          }]
        };
      }
      
      return { confidence: 0.0, sources: [] };
      
    } catch (error) {
      if (error.response?.status === 404) {
        return { confidence: 0.0, sources: [] };
      }
      throw error;
    }
  }

  async verifyWithFactCheckAPI(claim) {
    try {
      if (!this.apiKey) {
        return { confidence: 0.0, sources: [] };
      }
      
      const response = await axios.get(`${this.baseUrl}/claims:search`, {
        params: {
          query: claim.substring(0, 100), // Limit query length
          key: this.apiKey
        },
        timeout: 10000
      });
      
      if (response.data && response.data.claims && response.data.claims.length > 0) {
        const relevantClaims = response.data.claims.slice(0, 3);
        const avgRating = this.calculateFactCheckRating(relevantClaims);
        
        return {
          confidence: avgRating,
          sources: relevantClaims.map(claim => ({
            type: 'fact_check',
            claimant: claim.claimant,
            text: claim.text,
            rating: claim.claimReview?.[0]?.textualRating,
            url: claim.claimReview?.[0]?.url,
            publisher: claim.claimReview?.[0]?.publisher?.name
          }))
        };
      }
      
      return { confidence: 0.0, sources: [] };
      
    } catch (error) {
      if (error.response?.status === 403) {
        logger.warn('Fact check API key invalid or quota exceeded');
        return { confidence: 0.0, sources: [] };
      }
      throw error;
    }
  }

  extractKeyTerms(text) {
    // Simple key term extraction
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    // Remove common words
    const stopWords = new Set(['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other']);
    const keyWords = words.filter(word => !stopWords.has(word));
    
    return keyWords.slice(0, 3);
  }

  calculateTextSimilarity(text1, text2) {
    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  calculateFactCheckRating(claims) {
    const ratingMap = {
      'true': 1.0,
      'mostly true': 0.8,
      'half true': 0.5,
      'mostly false': 0.2,
      'false': 0.0,
      'pants on fire': 0.0
    };
    
    let totalRating = 0;
    let ratedClaims = 0;
    
    claims.forEach(claim => {
      if (claim.claimReview && claim.claimReview[0]) {
        const rating = claim.claimReview[0].textualRating?.toLowerCase();
        if (rating && ratingMap.hasOwnProperty(rating)) {
          totalRating += ratingMap[rating];
          ratedClaims++;
        }
      }
    });
    
    return ratedClaims > 0 ? totalRating / ratedClaims : 0.5;
  }

  aggregateSources(verificationResults) {
    return verificationResults
      .flatMap(result => result.sources || [])
      .filter(source => source && source.url)
      .slice(0, 10); // Limit sources
  }
}

class BiasDetectionAgent {
  constructor() {
    this.biasPatterns = this.initializeBiasPatterns();
  }

  initializeBiasPatterns() {
    return {
      political: {
        left: ['progressive', 'liberal', 'socialist', 'democrat'],
        right: ['conservative', 'republican', 'traditional', 'libertarian']
      },
      gender: ['he said', 'she said', 'men are', 'women are', 'guys', 'girls'],
      racial: ['people of color', 'minorities', 'ethnic groups'],
      emotional: ['obviously', 'clearly', 'everyone knows', 'it is obvious'],
      confirmation: ['proves that', 'confirms', 'as expected', 'predictably']
    };
  }

  async detectBias(content, context = {}) {
    const detectionId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting bias detection', { detectionId, contentLength: content.length });
      
      const biasAnalysis = {
        detectionId,
        overallBiasScore: 0,
        detectedBiases: [],
        recommendations: [],
        responseTime: 0
      };
      
      // Detect different types of bias
      const politicalBias = this.detectPoliticalBias(content);
      const genderBias = this.detectGenderBias(content);
      const emotionalBias = this.detectEmotionalBias(content);
      const confirmationBias = this.detectConfirmationBias(content);
      
      // Aggregate bias scores
      const biasScores = [politicalBias, genderBias, emotionalBias, confirmationBias];
      biasAnalysis.overallBiasScore = biasScores.reduce((sum, bias) => sum + bias.score, 0) / biasScores.length;
      
      // Collect detected biases
      biasAnalysis.detectedBiases = biasScores
        .filter(bias => bias.score > 0.3)
        .map(bias => ({
          type: bias.type,
          score: bias.score,
          indicators: bias.indicators,
          examples: bias.examples
        }));
      
      // Generate recommendations
      biasAnalysis.recommendations = this.generateRecommendations(biasAnalysis.detectedBiases);
      biasAnalysis.responseTime = Date.now() - startTime;
      
      logger.info('Bias detection completed', {
        detectionId,
        overallBiasScore: biasAnalysis.overallBiasScore,
        detectedBiasesCount: biasAnalysis.detectedBiases.length
      });
      
      return biasAnalysis;
      
    } catch (error) {
      logger.logError(error, { component: 'biasDetectionAgent', operation: 'detectBias', detectionId });
      
      return {
        detectionId,
        overallBiasScore: 0,
        detectedBiases: [],
        recommendations: [],
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  detectPoliticalBias(content) {
    const contentLower = content.toLowerCase();
    let leftScore = 0;
    let rightScore = 0;
    const indicators = [];
    
    this.biasPatterns.political.left.forEach(term => {
      const matches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      leftScore += matches;
      if (matches > 0) indicators.push({ term, count: matches, leaning: 'left' });
    });
    
    this.biasPatterns.political.right.forEach(term => {
      const matches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      rightScore += matches;
      if (matches > 0) indicators.push({ term, count: matches, leaning: 'right' });
    });
    
    const totalScore = leftScore + rightScore;
    const biasScore = totalScore > 0 ? Math.abs(leftScore - rightScore) / totalScore : 0;
    
    return {
      type: 'political',
      score: Math.min(biasScore, 1.0),
      indicators,
      examples: indicators.slice(0, 3)
    };
  }

  detectGenderBias(content) {
    const contentLower = content.toLowerCase();
    let biasScore = 0;
    const indicators = [];
    
    this.biasPatterns.gender.forEach(pattern => {
      const matches = (contentLower.match(new RegExp(pattern, 'g')) || []).length;
      if (matches > 0) {
        biasScore += matches * 0.1;
        indicators.push({ pattern, count: matches });
      }
    });
    
    // Check for gendered pronouns imbalance
    const heMatches = (contentLower.match(/\bhe\b/g) || []).length;
    const sheMatches = (contentLower.match(/\bshe\b/g) || []).length;
    
    if (heMatches + sheMatches > 0) {
      const imbalance = Math.abs(heMatches - sheMatches) / (heMatches + sheMatches);
      biasScore += imbalance * 0.3;
      indicators.push({ pattern: 'pronoun_imbalance', he: heMatches, she: sheMatches, imbalance });
    }
    
    return {
      type: 'gender',
      score: Math.min(biasScore, 1.0),
      indicators,
      examples: indicators.slice(0, 3)
    };
  }

  detectEmotionalBias(content) {
    const contentLower = content.toLowerCase();
    let biasScore = 0;
    const indicators = [];
    
    this.biasPatterns.emotional.forEach(pattern => {
      const matches = (contentLower.match(new RegExp(pattern, 'g')) || []).length;
      if (matches > 0) {
        biasScore += matches * 0.2;
        indicators.push({ pattern, count: matches });
      }
    });
    
    // Check for excessive use of superlatives
    const superlatives = ['best', 'worst', 'always', 'never', 'all', 'none', 'every', 'completely'];
    superlatives.forEach(word => {
      const matches = (contentLower.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      if (matches > 0) {
        biasScore += matches * 0.1;
        indicators.push({ pattern: `superlative_${word}`, count: matches });
      }
    });
    
    return {
      type: 'emotional',
      score: Math.min(biasScore, 1.0),
      indicators,
      examples: indicators.slice(0, 3)
    };
  }

  detectConfirmationBias(content) {
    const contentLower = content.toLowerCase();
    let biasScore = 0;
    const indicators = [];
    
    this.biasPatterns.confirmation.forEach(pattern => {
      const matches = (contentLower.match(new RegExp(pattern, 'g')) || []).length;
      if (matches > 0) {
        biasScore += matches * 0.25;
        indicators.push({ pattern, count: matches });
      }
    });
    
    return {
      type: 'confirmation',
      score: Math.min(biasScore, 1.0),
      indicators,
      examples: indicators.slice(0, 3)
    };
  }

  generateRecommendations(detectedBiases) {
    const recommendations = [];
    
    detectedBiases.forEach(bias => {
      switch (bias.type) {
        case 'political':
          recommendations.push('Consider presenting multiple political perspectives to maintain neutrality');
          break;
        case 'gender':
          recommendations.push('Use gender-neutral language and ensure balanced representation');
          break;
        case 'emotional':
          recommendations.push('Replace emotional language with more objective, fact-based statements');
          break;
        case 'confirmation':
          recommendations.push('Present evidence that challenges the main argument to avoid confirmation bias');
          break;
      }
    });
    
    return recommendations;
  }
}

class CoherenceAgent {
  constructor() {
    this.coherenceMetrics = ['logical_flow', 'topic_consistency', 'argument_structure', 'clarity'];
  }

  async analyzeCoherence(content, context = {}) {
    const analysisId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting coherence analysis', { analysisId, contentLength: content.length });
      
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      if (sentences.length === 0) {
        return {
          analysisId,
          overallScore: 0,
          metrics: {},
          issues: ['No sentences found'],
          responseTime: Date.now() - startTime
        };
      }
      
      const metrics = {
        logical_flow: this.analyzeLogicalFlow(sentences),
        topic_consistency: this.analyzeTopicConsistency(sentences),
        argument_structure: this.analyzeArgumentStructure(sentences),
        clarity: this.analyzeClarity(sentences)
      };
      
      const overallScore = Object.values(metrics).reduce((sum, score) => sum + score, 0) / Object.keys(metrics).length;
      const issues = this.identifyCoherenceIssues(metrics, sentences);
      
      const result = {
        analysisId,
        overallScore,
        metrics,
        issues,
        recommendations: this.generateCoherenceRecommendations(issues),
        responseTime: Date.now() - startTime
      };
      
      logger.info('Coherence analysis completed', {
        analysisId,
        overallScore: result.overallScore,
        issuesCount: issues.length
      });
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'coherenceAgent', operation: 'analyzeCoherence', analysisId });
      
      return {
        analysisId,
        overallScore: 0,
        metrics: {},
        issues: [],
        error: error.message,
        responseTime: Date.now() - startTime
      };
    }
  }

  analyzeLogicalFlow(sentences) {
    if (sentences.length < 2) return 1.0;
    
    let flowScore = 0;
    const transitionWords = ['however', 'therefore', 'furthermore', 'moreover', 'consequently', 'additionally', 'meanwhile', 'nevertheless'];
    
    for (let i = 1; i < sentences.length; i++) {
      const currentSentence = sentences[i].toLowerCase();
      const hasTransition = transitionWords.some(word => currentSentence.includes(word));
      
      if (hasTransition) {
        flowScore += 1;
      }
      
      // Check for topic continuity (simplified)
      const prevWords = new Set(sentences[i-1].toLowerCase().split(/\s+/));
      const currWords = new Set(currentSentence.split(/\s+/));
      const overlap = new Set([...prevWords].filter(x => currWords.has(x)));
      
      if (overlap.size > 0) {
        flowScore += 0.5;
      }
    }
    
    return Math.min(flowScore / (sentences.length - 1), 1.0);
  }

  analyzeTopicConsistency(sentences) {
    if (sentences.length === 0) return 0;
    
    // Extract key terms from each sentence
    const sentenceTerms = sentences.map(sentence => {
      return sentence.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3);
    });
    
    // Calculate term frequency across all sentences
    const termFreq = {};
    sentenceTerms.flat().forEach(term => {
      termFreq[term] = (termFreq[term] || 0) + 1;
    });
    
    // Find common terms (appearing in multiple sentences)
    const commonTerms = Object.keys(termFreq).filter(term => termFreq[term] > 1);
    
    if (commonTerms.length === 0) return 0.3;
    
    // Calculate consistency score based on common term distribution
    let consistencyScore = 0;
    sentenceTerms.forEach(terms => {
      const commonInSentence = terms.filter(term => commonTerms.includes(term));
      consistencyScore += commonInSentence.length / Math.max(terms.length, 1);
    });
    
    return consistencyScore / sentences.length;
  }

  analyzeArgumentStructure(sentences) {
    if (sentences.length === 0) return 0;
    
    let structureScore = 0;
    
    // Check for introduction patterns
    const firstSentence = sentences[0].toLowerCase();
    if (firstSentence.includes('this') || firstSentence.includes('in this') || firstSentence.includes('the following')) {
      structureScore += 0.3;
    }
    
    // Check for conclusion patterns
    const lastSentence = sentences[sentences.length - 1].toLowerCase();
    if (lastSentence.includes('therefore') || lastSentence.includes('in conclusion') || lastSentence.includes('thus')) {
      structureScore += 0.3;
    }
    
    // Check for supporting evidence patterns
    const evidenceWords = ['because', 'since', 'due to', 'as a result', 'for example', 'such as'];
    const evidenceSentences = sentences.filter(sentence => 
      evidenceWords.some(word => sentence.toLowerCase().includes(word))
    );
    
    structureScore += Math.min(evidenceSentences.length / sentences.length, 0.4);
    
    return structureScore;
  }

  analyzeClarity(sentences) {
    if (sentences.length === 0) return 0;
    
    let clarityScore = 0;
    
    sentences.forEach(sentence => {
      const words = sentence.split(/\s+/);
      
      // Penalize very long sentences
      if (words.length > 30) {
        clarityScore -= 0.1;
      } else if (words.length > 20) {
        clarityScore -= 0.05;
      }
      
      // Reward moderate sentence length
      if (words.length >= 8 && words.length <= 20) {
        clarityScore += 0.1;
      }
      
      // Check for passive voice (simplified)
      if (sentence.toLowerCase().includes(' was ') || sentence.toLowerCase().includes(' were ')) {
        clarityScore -= 0.05;
      }
      
      // Reward active voice indicators
      const activeIndicators = [' is ', ' are ', ' will ', ' can ', ' does '];
      if (activeIndicators.some(indicator => sentence.toLowerCase().includes(indicator))) {
        clarityScore += 0.05;
      }
    });
    
    // Normalize score
    return Math.max(0, Math.min(1, 0.7 + clarityScore / sentences.length));
  }

  identifyCoherenceIssues(metrics, sentences) {
    const issues = [];
    
    if (metrics.logical_flow < 0.5) {
      issues.push('Poor logical flow between sentences - consider adding transition words');
    }
    
    if (metrics.topic_consistency < 0.4) {
      issues.push('Low topic consistency - sentences may be discussing unrelated topics');
    }
    
    if (metrics.argument_structure < 0.3) {
      issues.push('Weak argument structure - missing clear introduction, evidence, or conclusion');
    }
    
    if (metrics.clarity < 0.5) {
      issues.push('Clarity issues - sentences may be too long or use passive voice');
    }
    
    // Check for very short or very long content
    if (sentences.length < 3) {
      issues.push('Content is too brief to be coherent');
    } else if (sentences.length > 50) {
      issues.push('Content may be too long and lose coherence');
    }
    
    return issues;
  }

  generateCoherenceRecommendations(issues) {
    const recommendations = [];
    
    issues.forEach(issue => {
      if (issue.includes('logical flow')) {
        recommendations.push('Add transition words like "however", "therefore", "furthermore" to improve flow');
      } else if (issue.includes('topic consistency')) {
        recommendations.push('Ensure all sentences relate to the main topic and remove tangential content');
      } else if (issue.includes('argument structure')) {
        recommendations.push('Structure content with clear introduction, supporting evidence, and conclusion');
      } else if (issue.includes('clarity')) {
        recommendations.push('Break down long sentences and use active voice for better clarity');
      }
    });
    
    return recommendations;
  }
}

class MultiAgentReasoning {
  constructor() {
    this.factCheckingAgent = new FactCheckingAgent();
    this.biasDetectionAgent = new BiasDetectionAgent();
    this.coherenceAgent = new CoherenceAgent();
  }

  async analyzeContent(content, options = {}) {
    const analysisId = uuidv4();
    const startTime = Date.now();
    
    try {
      logger.info('Starting multi-agent content analysis', { analysisId, contentLength: content.length });
      
      // Run all agents in parallel
      const [factCheck, biasAnalysis, coherenceAnalysis] = await Promise.all([
        this.factCheckingAgent.verifyFacts(content, options),
        this.biasDetectionAgent.detectBias(content, options),
        this.coherenceAgent.analyzeCoherence(content, options)
      ]);
      
      // Calculate overall quality score
      const qualityScore = this.calculateOverallQuality(factCheck, biasAnalysis, coherenceAnalysis);
      
      const result = {
        analysisId,
        qualityScore,
        factCheck,
        biasAnalysis,
        coherenceAnalysis,
        recommendations: this.aggregateRecommendations(factCheck, biasAnalysis, coherenceAnalysis),
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      logger.info('Multi-agent analysis completed', {
        analysisId,
        qualityScore: result.qualityScore,
        responseTime: result.responseTime
      });
      
      return result;
      
    } catch (error) {
      logger.logError(error, { component: 'multiAgentReasoning', operation: 'analyzeContent', analysisId });
      throw error;
    }
  }

  calculateOverallQuality(factCheck, biasAnalysis, coherenceAnalysis) {
    const weights = {
      factual: 0.4,
      bias: 0.3,
      coherence: 0.3
    };
    
    const factualScore = factCheck.confidence || 0;
    const biasScore = 1 - (biasAnalysis.overallBiasScore || 0); // Lower bias is better
    const coherenceScore = coherenceAnalysis.overallScore || 0;
    
    return (
      factualScore * weights.factual +
      biasScore * weights.bias +
      coherenceScore * weights.coherence
    );
  }

  aggregateRecommendations(factCheck, biasAnalysis, coherenceAnalysis) {
    const recommendations = [];
    
    // Fact-checking recommendations
    if (factCheck.confidence < 0.7) {
      recommendations.push({
        type: 'factual',
        priority: 'high',
        message: 'Verify factual claims with reliable sources',
        sources: factCheck.sources || []
      });
    }
    
    // Bias recommendations
    if (biasAnalysis.overallBiasScore > 0.5) {
      recommendations.push({
        type: 'bias',
        priority: 'medium',
        message: 'Reduce bias by using more neutral language',
        details: biasAnalysis.recommendations || []
      });
    }
    
    // Coherence recommendations
    if (coherenceAnalysis.overallScore < 0.6) {
      recommendations.push({
        type: 'coherence',
        priority: 'medium',
        message: 'Improve content structure and clarity',
        details: coherenceAnalysis.recommendations || []
      });
    }
    
    return recommendations;
  }
}

module.exports = {
  MultiAgentReasoning,
  FactCheckingAgent,
  BiasDetectionAgent,
  CoherenceAgent
};