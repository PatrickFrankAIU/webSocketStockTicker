// DOM Elements
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const updateBtn = document.getElementById('update-btn');
const statusMessage = document.getElementById('status-message');
const connectionStatus = document.getElementById('connection-status');
const stockContainer = document.getElementById('stock-container');
const logContainer = document.getElementById('log-container');
const stockCheckboxes = document.querySelectorAll('.stock-checkbox');

// WebSocket instance and data state
let socket = null;
let subscribedStocks = new Set();
let stockData = {};

// Helper function to log messages to the UI
function logMessage(event, data = '') {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    
    let message = `<span class="log-time">${timeString}</span><span class="log-event">${event}</span>`;
    
    if (data) {
        // Format data as JSON if it's an object
        const formattedData = typeof data === 'object' ? JSON.stringify(data) : data;
        message += ` <span class="log-data">${formattedData}</span>`;
    }
    
    logEntry.innerHTML = message;
    logContainer.appendChild(logEntry);
    
    // Auto-scroll to the bottom
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Connect to WebSocket server
function connectWebSocket() {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        updateStatus('Already connected or connecting');
        return;
    }
    
    updateStatus('Connecting to WebSocket server...');
    setConnectionState('connecting');
    
    // Connect to EODHD WebSocket server
    socket = new WebSocket('wss://ws.eodhistoricaldata.com/ws/us?api_token=demo');
    
    // Connection opened
    socket.addEventListener('open', (event) => {
        updateStatus('Connected to WebSocket server!');
        setConnectionState('connected');
        logMessage('Connection opened');
        
        // Update UI to allow updating subscriptions
        updateBtn.disabled = false;
        
        // If there are any previously selected stocks, subscribe to them
        updateSubscriptions();
    });
    
    // Listen for messages
    socket.addEventListener('message', (event) => {
        try {
            const data = JSON.parse(event.data);
            logMessage('Message received', data);
            
            // Check if it's a status message
            if (data.status_code) {
                if (data.status_code === 200) {
                    logMessage('Status', `Success: ${data.message}`);
                } else {
                    logMessage('Error', `Error ${data.status_code}: ${data.message}`);
                }
                return;
            }
            
            // Process the incoming data if it's a price update
            processStockData(data);
        } catch (error) {
            // Handle parsing error
            logMessage('Error parsing message', error.message);
            console.error('Error parsing message:', error, event.data);
        }
    });
    
    // Connection closed
    socket.addEventListener('close', (event) => {
        updateStatus('Disconnected from server.');
        setConnectionState('disconnected');
        logMessage('Connection closed', `Code: ${event.code}, Reason: ${event.reason}`);
        
        // Reset UI
        resetUI();
    });
    
    // Connection error
    socket.addEventListener('error', (event) => {
        updateStatus('Error connecting to server!');
        setConnectionState('disconnected');
        logMessage('Connection error');
        console.error('WebSocket error:', event);
        
        // Reset UI
        resetUI();
    });
}

// Disconnect WebSocket
function disconnectWebSocket() {
    if (socket) {
        socket.close();
        socket = null;
    }
}

// Update status message
function updateStatus(message) {
    statusMessage.textContent = message;
}

// Set connection state UI
function setConnectionState(state) {
    connectionStatus.className = state;
    connectionStatus.textContent = state.charAt(0).toUpperCase() + state.slice(1);
    
    // Update buttons based on connection state
    if (state === 'connected' || state === 'connecting') {
        connectBtn.disabled = true;
    } else {
        connectBtn.disabled = false;
    }
    
    if (state === 'connected') {
        disconnectBtn.disabled = false;
        updateBtn.disabled = false;
    } else {
        disconnectBtn.disabled = true;
        updateBtn.disabled = true;
    }
    
    // Enable/disable checkboxes based on connection state
    stockCheckboxes.forEach(checkbox => {
        if (state === 'connected') {
            checkbox.disabled = false;
        } else {
            checkbox.disabled = true;
        }
    });
}

// Reset UI elements
function resetUI() {
    setConnectionState('disconnected');
    subscribedStocks.clear();
    stockData = {};
    renderStocks();
}

// Get selected stocks
function getSelectedStocks() {
    const selected = [];
    stockCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            selected.push(checkbox.value);
        }
    });
    return selected;
}

// Update WebSocket subscriptions
function updateSubscriptions() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        updateStatus('Not connected to server.');
        return;
    }
    
    const selectedStocks = getSelectedStocks();
    
    if (selectedStocks.length === 0) {
        // No stocks selected, show empty state
        subscribedStocks.clear();
        stockData = {};
        renderStocks();
        updateStatus('No stocks selected. Select stocks to track.');
        return;
    }
    
    // Send subscription message - According to examples in their official library
    // Format: {"action": "subscribe", "symbols": "AAPL,MSFT"}
    const subscribeCommand = {
        action: "subscribe", 
        symbols: selectedStocks.join(',')
    };
    
    logMessage('Sending subscription', subscribeCommand);
    socket.send(JSON.stringify(subscribeCommand));
    
    // Update tracking
    subscribedStocks = new Set(selectedStocks);
    updateStatus(`Subscribed to ${selectedStocks.join(', ')}`);
    
    // Initialize stock cards
    selectedStocks.forEach(symbol => {
        if (!stockData[symbol]) {
            stockData[symbol] = {
                symbol,
                name: getStockName(symbol),
                price: null,
                change: null,
                previousPrice: null,
                lastUpdate: null
            };
        }
    });
    
    // Render stock cards
    renderStocks();
}

// Get friendly name for stock symbols
function getStockName(symbol) {
    const names = {
        'AAPL': 'Apple Inc.',
        'MSFT': 'Microsoft Corporation',
        'TSLA': 'Tesla, Inc.',
        'EURUSD': 'Euro/US Dollar',
        'ETH-USD': 'Ethereum/US Dollar',
        'BTC-USD': 'Bitcoin/US Dollar'
    };
    
    return names[symbol] || symbol;
}

// Process incoming stock data
function processStockData(data) {
    // Different data structures might be received
    // We need to check if it's a price update
    if (data && typeof data === 'object') {
        let symbol = null;
        let price = null;
        
        // Check for common properties in EODHD responses
        if (data.s) {
            symbol = data.s;
        } 
        
        if (data.p) {
            price = parseFloat(data.p);
        }
        
        // Only process if we have both symbol and price
        if (symbol && price && !isNaN(price) && subscribedStocks.has(symbol)) {
            // Store previous price for comparison
            const previousPrice = stockData[symbol].price;
            
            // Calculate change
            let change = null;
            if (previousPrice) {
                change = price - previousPrice;
            }
            
            // Update stock data
            stockData[symbol] = {
                ...stockData[symbol],
                price: price,
                previousPrice,
                change: change,
                lastUpdate: new Date().toLocaleTimeString()
            };
            
            // Render updated stock data
            renderStocks();
        }
    }
}

// Render stock cards
function renderStocks() {
    if (subscribedStocks.size === 0) {
        stockContainer.innerHTML = '<div class="no-stocks">Select stocks above and connect to see real-time prices</div>';
        return;
    }
    
    stockContainer.innerHTML = '';
    
    // Convert to array for sorting
    const stocksArray = Array.from(subscribedStocks)
        .map(symbol => stockData[symbol])
        .filter(stock => stock); // Remove undefined stocks
    
    // Sort by symbol
    stocksArray.sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    // Create card for each stock
    stocksArray.forEach(stock => {
        const stockCard = document.createElement('div');
        stockCard.className = 'stock-card';
        
        // Determine price direction class
        let priceClass = 'price-unchanged';
        if (stock.change) {
            if (stock.change > 0) {
                priceClass = 'price-up';
            } else if (stock.change < 0) {
                priceClass = 'price-down';
            } else {
                priceClass = 'price-unchanged';
            }
        }
        
        // Format price
        let priceDisplay;
        if (stock.price) {
            priceDisplay = `${stock.price.toFixed(2)}`;
        } else {
            priceDisplay = 'Loading...';
        }
        
        // Format change
        let changeDisplay = '';
        if (stock.change) {
            let changePrefix = '';
            let percentPrefix = '';
            
            if (stock.change > 0) {
                changePrefix = '+';
                percentPrefix = '+';
            }
            
            let percentChange = (stock.change / (stock.price - stock.change) * 100).toFixed(2);
            changeDisplay = `${changePrefix}${stock.change.toFixed(2)} (${percentPrefix}${percentChange}%)`;
        }
        
        // Format last update
        let updateDisplay;
        if (stock.lastUpdate) {
            updateDisplay = `Last update: ${stock.lastUpdate}`;
        } else {
            updateDisplay = 'Waiting for data...';
        }
        
        // Build the HTML
        let html = `<h3>${stock.name} (${stock.symbol})</h3>`;
        html += `<p class="stock-price ${priceClass}">${priceDisplay}</p>`;
        
        if (stock.change) {
            html += `<p class="stock-change ${priceClass}">${changeDisplay}</p>`;
        }
        
        html += `<p class="stock-update">${updateDisplay}</p>`;
        
        stockCard.innerHTML = html;
        stockContainer.appendChild(stockCard);
    });
}

// Event Listeners
connectBtn.addEventListener('click', () => {
    connectWebSocket();
});

disconnectBtn.addEventListener('click', () => {
    disconnectWebSocket();
});

updateBtn.addEventListener('click', () => {
    updateSubscriptions();
});

// Initialize with default stocks
stockCheckboxes.forEach(checkbox => {
    // Pre-select AAPL and MSFT by default
    if (checkbox.value === 'AAPL' || checkbox.value === 'MSFT') {
        checkbox.checked = true;
    }
});

// Initialize UI
updateStatus('Click "Connect" to start tracking stocks.');