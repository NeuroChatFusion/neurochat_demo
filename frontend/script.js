document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Fixed to match actual HTML structure
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const newConversationButton = document.getElementById('newConversationButton');
    const conversationList = document.getElementById('conversationList');
    
    // Sidebar elements - Added missing sidebar functionality
    const menuButton = document.getElementById('menuButton');
    const sidebar = document.getElementById('sidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    // State
    let conversations = [];
    let currentConversationId = null;
    let isProcessing = false;

    // API Configuration - Using real backend endpoints from queries.js
    const API_BASE_URL = 'http://localhost:12000';
    const API_ENDPOINTS = {
        queries: '/api/v1/queries',
        models: '/api/v1/models'
    };

    // Initialize app
    const init = () => {
        loadConversations();
        setupEventListeners();
        showWelcomeState();
        
        // Initialize textarea height
        messageInput.style.height = '3.5rem';
        
        // Trigger auto-resize on initial load and focus
        messageInput.addEventListener('focus', autoResizeTextarea);
        autoResizeTextarea();
        
        // Ensure chat window scrolls properly
        window.addEventListener('resize', scrollToBottom);
        
        // Initial scroll to bottom
        scrollToBottom();
    };

    // Setup all event listeners
    const setupEventListeners = () => {
        // Send message functionality
        sendButton.addEventListener('click', handleSendMessage);
        messageInput.addEventListener('keydown', handleKeyPress);
        
        // New conversation functionality
        newConversationButton.addEventListener('click', createNewConversation);
        
        // Sidebar functionality - Fixed missing sidebar controls
        menuButton.addEventListener('click', toggleSidebar);
        closeSidebar.addEventListener('click', closeSidebarPanel);
        sidebarOverlay.addEventListener('click', closeSidebarPanel);
        
        // Textarea auto-resize functionality
        messageInput.addEventListener('input', autoResizeTextarea);
        
        // Prevent form submission on Enter
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
            }
        });
    };
    
    // Auto-resize textarea based on content
    const autoResizeTextarea = () => {
        // Reset height to minimum to get the correct scrollHeight
        messageInput.style.height = '3.5rem';
        
        // Calculate the scroll height
        const scrollHeight = messageInput.scrollHeight;
        
        // If content is less than max height, resize the textarea
        // Otherwise, keep it at max height and let scrolling handle it
        if (scrollHeight <= 200) {
            messageInput.style.height = `${scrollHeight}px`;
        } else {
            messageInput.style.height = '200px';
        }
    };

    // Handle key press events
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // Sidebar functionality - Added missing sidebar controls
    const toggleSidebar = () => {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
        menuButton.classList.toggle('active');
    };

    const closeSidebarPanel = () => {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
        menuButton.classList.remove('active');
    };

    // Show welcome state when no conversations exist
    const showWelcomeState = () => {
        if (conversations.length === 0 || !currentConversationId) {
            chatMessages.innerHTML = `
                <div class="empty-state">
                    <h2>Welcome to NeuroChat</h2>
                    <p>Start a conversation by typing a message below or click "New Conversation" to begin.</p>
                </div>
            `;
        }
    };

    // Load conversations from localStorage
    const loadConversations = () => {
        try {
            const savedConversations = localStorage.getItem('neurochat-conversations');
            if (savedConversations) {
                conversations = JSON.parse(savedConversations);
                renderConversationsList();
                
                // Load the most recent conversation if exists
                if (conversations.length > 0 && !currentConversationId) {
                    loadConversation(conversations[0].id);
                }
            } else {
                renderEmptyConversationsList();
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
            conversations = [];
            renderEmptyConversationsList();
        }
    };

    // Save conversations to localStorage
    const saveConversations = () => {
        try {
            localStorage.setItem('neurochat-conversations', JSON.stringify(conversations));
        } catch (error) {
            console.error('Error saving conversations:', error);
        }
    };

    // Render conversations list
    const renderConversationsList = () => {
        if (conversations.length === 0) {
            renderEmptyConversationsList();
            return;
        }

        conversationList.innerHTML = '';
        conversations.forEach(conversation => {
            const conversationItem = document.createElement('div');
            conversationItem.classList.add('conversation-item');
            if (conversation.id === currentConversationId) {
                conversationItem.classList.add('active');
            }
            
            conversationItem.innerHTML = `
                <div class="conversation-title">${conversation.title}</div>
                <div class="conversation-preview">${getConversationPreview(conversation)}</div>
                <div class="conversation-date">${formatDate(conversation.lastUpdated || conversation.created)}</div>
            `;
            
            conversationItem.dataset.id = conversation.id;
            conversationItem.addEventListener('click', () => {
                loadConversation(conversation.id);
                closeSidebarPanel(); // Close sidebar on mobile after selection
            });
            
            conversationList.appendChild(conversationItem);
        });
    };

    // Render empty conversations list
    const renderEmptyConversationsList = () => {
        conversationList.innerHTML = `
            <div class="empty-conversations">
                No previous conversations.<br>
                Start a new conversation to begin!
            </div>
        `;
    };

    // Get conversation preview text
    const getConversationPreview = (conversation) => {
        if (conversation.messages.length === 0) return 'New conversation';
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        const preview = lastMessage.content.substring(0, 100);
        return preview.length < lastMessage.content.length ? preview + '...' : preview;
    };

    // Format date for display
    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) return 'Today';
        if (diffDays === 2) return 'Yesterday';
        if (diffDays <= 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString();
    };

    // Create a new conversation
    const createNewConversation = () => {
        const id = Date.now().toString();
        const newConversation = {
            id,
            title: 'New Conversation',
            messages: [],
            created: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        conversations.unshift(newConversation);
        saveConversations();
        loadConversation(id);
        renderConversationsList();
        
        // Focus on input after creating new conversation
        messageInput.focus();
    };

    // Load a conversation
    const loadConversation = (id) => {
        currentConversationId = id;
        const conversation = conversations.find(conv => conv.id === id);
        
        if (!conversation) {
            console.error('Conversation not found:', id);
            return;
        }
        
        // Clear messages container
        chatMessages.innerHTML = '';
        
        // Render messages if any exist
        if (conversation.messages.length > 0) {
            conversation.messages.forEach(message => {
                renderMessage(message.role, message.content);
            });
        } else {
            showWelcomeState();
        }
        
        // Update active conversation in the list
        renderConversationsList();
        
        // Scroll to bottom with a slight delay to ensure rendering is complete
        setTimeout(scrollToBottom, 50);
        scrollToBottom();
    };

    // Render a message - Fixed CSS classes to match style.css
    const renderMessage = (role, content) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.classList.add(role === 'user' ? 'user-message' : 'ai-message');
        
        // Handle different content types
        if (typeof content === 'string') {
            messageElement.textContent = content;
        } else {
            messageElement.innerHTML = content;
        }
        
        // Add message to DOM
        chatMessages.appendChild(messageElement);
        
        // Force layout recalculation before scrolling
        messageElement.offsetHeight;
        
        // Scroll to bottom with a slight delay to ensure rendering is complete
        setTimeout(scrollToBottom, 10);
        scrollToBottom();
    };

    // Show thinking animation - Fixed to match CSS structure
    const showThinking = () => {
        const thinkingElement = document.createElement('div');
        thinkingElement.classList.add('message', 'thinking-message');
        thinkingElement.innerHTML = `
            NeuroChat is thinking
            <div class="thinking-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        `;
        chatMessages.appendChild(thinkingElement);
        
        // Force layout recalculation before scrolling
        thinkingElement.offsetHeight;
        
        // Scroll to bottom with a slight delay to ensure rendering is complete
        setTimeout(scrollToBottom, 10);
        scrollToBottom();
        
        return thinkingElement;
    };

    // Scroll to bottom of chat
    const scrollToBottom = () => {
        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    };

    // Send message to API - Fixed to use real backend endpoints from queries.js
    const sendMessageToAPI = async (message) => {
        try {
            // Step 1: Submit query to backend using real API from queries.js
            const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.queries}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    query: message,
                    options: {
                        priority: 0,
                        skipCache: false,
                        enhanceWithKnowledge: true,
                        enableLearning: true,
                        maxTokens: 2000,
                        temperature: 0.7,
                        timeout: 30000
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Query submission failed');
            }

            const queryId = data.queryId;
            
            // Step 2: Poll for results using the real API structure
            let resultData = null;
            let retries = 0;
            const maxRetries = 60; // 60 seconds max wait time
            const pollingInterval = 1000; // Poll every second
            
            while (retries < maxRetries) {
                const resultResponse = await fetch(`${API_BASE_URL}${API_ENDPOINTS.queries}/${queryId}`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (!resultResponse.ok) {
                    if (resultResponse.status === 404) {
                        throw new Error('Query not found');
                    } else if (resultResponse.status === 500) {
                        const errorData = await resultResponse.json().catch(() => ({}));
                        throw new Error(errorData.message || 'Processing failed');
                    }
                    // For 202 (still processing), continue polling
                }
                
                resultData = await resultResponse.json();
                
                // Check if processing is complete
                if (resultData.success && resultData.result) {
                    return resultData.result.content;
                } else if (resultData.status === 'failed') {
                    throw new Error(resultData.reason || 'Processing failed');
                }
                
                // Wait before polling again
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
                retries++;
            }
            
            throw new Error('Request timed out. Please try again.');
            
        } catch (error) {
            console.error('Error sending message to API:', error);
            
            // Return user-friendly error messages
            if (error.message.includes('fetch')) {
                return 'Sorry, I cannot connect to the server right now. Please check your connection and try again.';
            } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
                return 'The request is taking longer than expected. Please try again with a shorter message.';
            } else {
                return `Sorry, there was an error processing your request: ${error.message}`;
            }
        }
    };

    // Handle send message - Fixed to work with all UI elements
    const handleSendMessage = async () => {
        if (isProcessing) return; // Prevent multiple simultaneous requests
        
        const message = messageInput.value.trim();
        if (!message) return;
        
        // Set processing state
        isProcessing = true;
        sendButton.disabled = true;
        // Keep the SVG icon but add a loading class
        sendButton.classList.add('loading');
        
        // Clear input and reset height
        messageInput.value = '';
        messageInput.style.height = '3.5rem';
        
        try {
            // Create new conversation if none exists
            if (!currentConversationId) {
                createNewConversation();
            }
            
            // Get current conversation
            const conversation = conversations.find(conv => conv.id === currentConversationId);
            if (!conversation) {
                throw new Error('No active conversation found');
            }
            
            // Add user message to UI
            renderMessage('user', message);
            
            // Add user message to conversation
            conversation.messages.push({ 
                role: 'user', 
                content: message,
                timestamp: new Date().toISOString()
            });
            
            // Update conversation title if it's the first message
            if (conversation.messages.length === 1) {
                conversation.title = message.length > 50 ? message.substring(0, 50) + '...' : message;
                renderConversationsList();
            }
            
            // Update last updated timestamp
            conversation.lastUpdated = new Date().toISOString();
            
            // Save conversations
            saveConversations();
            
            // Show thinking animation
            const thinkingElement = showThinking();
            
            // Send message to API
            const response = await sendMessageToAPI(message);
            
            // Remove thinking animation
            if (thinkingElement && thinkingElement.parentNode) {
                thinkingElement.remove();
            }
            
            // Add AI response to UI
            renderMessage('ai', response);
            
            // Add AI response to conversation
            conversation.messages.push({ 
                role: 'ai', 
                content: response,
                timestamp: new Date().toISOString()
            });
            
            // Update last updated timestamp
            conversation.lastUpdated = new Date().toISOString();
            
            // Save conversations
            saveConversations();
            
            // Update conversations list to show new preview
            renderConversationsList();
            
        } catch (error) {
            console.error('Error in handleSendMessage:', error);
            
            // Remove thinking animation if it exists
            const thinkingElement = chatMessages.querySelector('.thinking-message');
            if (thinkingElement) {
                thinkingElement.remove();
            }
            
            // Show error message
            renderMessage('ai', 'Sorry, there was an error processing your message. Please try again.');
            
        } finally {
            // Reset processing state
            isProcessing = false;
            sendButton.disabled = false;
            sendButton.classList.remove('loading');
            
            // Focus back on input
            messageInput.focus();
        }
    };

    // Initialize the application
    init();
});

