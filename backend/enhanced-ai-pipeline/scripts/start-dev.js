#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Enhanced AI Pipeline in Development Mode...\n');

// Check if Redis is running
const checkRedis = spawn('redis-cli', ['ping']);

checkRedis.on('close', (code) => {
  if (code !== 0) {
    console.log('⚠️  Redis not running. Starting Redis server...');
    
    // Try to start Redis
    const redis = spawn('redis-server', [], { 
      stdio: 'inherit',
      detached: true 
    });
    
    redis.unref();
    
    setTimeout(() => {
      startApplication();
    }, 2000);
  } else {
    console.log('✅ Redis is running');
    startApplication();
  }
});

function startApplication() {
  console.log('🔧 Starting application server...\n');
  
  const server = spawn('node', [path.join(__dirname, '../src/api/server.js')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development'
    }
  });
  
  server.on('close', (code) => {
    console.log(`\n📊 Server exited with code ${code}`);
    process.exit(code);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.kill('SIGTERM');
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.kill('SIGTERM');
  });
}