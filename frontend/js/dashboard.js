class Dashboard {
    constructor() {
        this.currentPage = 1;
        // Use a constant for the refresh interval for better readability and maintenance.
        this.STATS_REFRESH_INTERVAL = 30000; // 30 seconds
        // Debounce delay for search input to avoid excessive API calls.
        this.SEARCH_DEBOUNCE_DELAY = 400; // 400ms
        this.limit = 20;
        this.filters = {
            search: '',
            fromDate: '',
            toDate: '',
            status: 'all'
        };
        this.debouncedLoadConversations = this.debounce(this.loadConversations, this.SEARCH_DEBOUNCE_DELAY);

        this.cacheDOMElements();
        this.init();
    }

    cacheDOMElements() {
        this.searchInput = document.getElementById('search-input');
        this.dateFromInput = document.getElementById('date-from');
        this.dateToInput = document.getElementById('date-to');
        this.statusFilter = document.getElementById('status-filter');
        this.refreshBtn = document.getElementById('refresh-btn');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.conversationModal = document.getElementById('conversation-modal');
        this.modalCloseBtn = document.querySelector('.close-btn');
        this.conversationsBody = document.getElementById('conversations-body');
        this.conversationDetailContainer = document.getElementById('conversation-detail');
    }

    init() {
        this.setupEventListeners();
        this.loadStats();
        this.loadConversations();
        this.startAutoRefresh();
    }
    
    setupEventListeners() {
        // Search input with debouncing
        this.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.currentPage = 1;
            this.debouncedLoadConversations();
        });

        // Date filters
        this.dateFromInput.addEventListener('change', (e) => {
            this.filters.fromDate = e.target.value;
            this.currentPage = 1;
            this.loadConversations();
        });

        this.dateToInput.addEventListener('change', (e) => {
            this.filters.toDate = e.target.value;
            this.currentPage = 1;
            this.loadConversations();
        });

        // Status filter
        this.statusFilter.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.currentPage = 1;
            this.loadConversations();
        });

        // Refresh button
        this.refreshBtn.addEventListener('click', () => {
            this.loadStats();
            this.loadConversations();
        });

        // Load more button
        this.loadMoreBtn.addEventListener('click', () => {
            this.currentPage++;
            this.loadConversations(true);
        });

        // Modal close
        this.modalCloseBtn.addEventListener('click', () => this.closeModal());

        // Click outside modal to close
        this.conversationModal.addEventListener('click', (e) => {
            if (e.target === this.conversationModal) this.closeModal();
        });

        // Event delegation for view buttons
        this.conversationsBody.addEventListener('click', (e) => {
            const viewButton = e.target.closest('.btn-view');
            if (viewButton) this.viewConversation(viewButton.dataset.id);
        });
    }

    async loadStats() {
        try {
            const stats = await api.get('/conversations/stats');
            document.getElementById('total-calls').textContent = stats.total_calls || 0;
            document.getElementById('ai-handled').textContent = stats.ai_handled || 0;
            document.getElementById('avg-duration').textContent = stats.avg_duration || '0:00';
            document.getElementById('today-calls').textContent = stats.last_24h || 0;
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async loadConversations(append = false) {
        try {
            const params = new URLSearchParams({
                limit: this.limit,
                offset: (this.currentPage - 1) * this.limit,
                search: this.filters.search,
                from_date: this.filters.fromDate,
                to_date: this.filters.toDate, // Note: API expects from_date, to_date
                status: this.filters.status
            });

            const data = await api.get(`/conversations?${params}`);
            
            if (append) {
                this.appendConversations(data.conversations);
            } else {
                this.renderConversations(data.conversations);
            }

            // Show/hide load more button
            this.loadMoreBtn.style.display = data.total > this.currentPage * this.limit ? 'block' : 'none';

        } catch (error) {
            console.error('Error loading conversations:', error);
        }
    }

    renderConversations(conversations) {
        this.conversationsBody.innerHTML = '';
        
        if (conversations.length === 0) {
            this.conversationsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;">No conversations found</td></tr>';
            return;
        }

        this.appendConversations(conversations);
    }

    appendConversations(conversations) {
        const startIndex = this.conversationsBody.children.length;
        
        const fragment = document.createDocumentFragment();
        conversations.map((conv, index) => this.createConversationRow(conv, startIndex + index))
            .forEach(row => fragment.appendChild(row));
        
        this.conversationsBody.appendChild(fragment);
    }

    createConversationRow(conv, index) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${this.formatCaller(conv.caller_number)}</td>
            <td>${this.formatDate(conv.start_time)}</td>
            <td>${this.formatDuration(conv.duration_seconds)}</td>
            <td><span class="status-badge status-${conv.call_status}">${conv.call_status.replace('_', ' ').toUpperCase()}</span></td>
            <td><button class="btn-view" data-id="${conv._id}">View</button></td>
        `;
        return row;
    }

    async viewConversation(conversationId) {
        try {
            const data = await api.get(`/conversations/${conversationId}`);
            this.renderConversationDetail(data);
            this.conversationModal.classList.add('active');
        } catch (error) {
            console.error('Error loading conversation:', error);
        }
    }

    renderConversationDetail(conversation) {
        this.conversationDetailContainer.innerHTML = `
            <h2>Conversation Details</h2>
            <div class="call-info">
                <p><strong>Caller:</strong> ${this.formatCaller(conversation.caller_number)}</p>
                <p><strong>Date:</strong> ${this.formatDate(conversation.start_time)}</p>
                <p><strong>Duration:</strong> ${this.formatDuration(conversation.duration_seconds)}</p>
                <p><strong>Status:</strong> ${conversation.call_status}</p>
            </div>
            
            ${conversation.summary ? `
                <div class="summary">
                    <h3>AI Summary</h3>
                    <p>${conversation.summary}</p>
                    ${conversation.sentiment ? `<p><strong>Sentiment:</strong> ${conversation.sentiment}</p>` : ''}
                    ${conversation.topics ? `<p><strong>Topics:</strong> ${conversation.topics.join(', ')}</p>` : ''}
                </div>
            ` : ''}
            
            <div class="transcript">
                <h3>Transcript</h3>
                ${conversation.transcript.map(entry => `
                    <div class="message ${entry.speaker}">
                        <span class="speaker">${entry.speaker === 'caller' ? '👤 Caller' : '🤖 AI Agent'}</span>
                        <span class="time">${this.formatTime(entry.timestamp)}</span>
                        <p>${entry.text}</p>
                    </div>
                `).join('')}
            </div>
        `;
    }

    closeModal() {
        this.conversationModal.classList.remove('active');
    }

    formatCaller(number) {
        if (!number) return 'Unknown';
        return number.replace(/(\+\d{1})(\d{3})(\d{3})(\d{4})/, '$1 ($2) $3-$4');
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    startAutoRefresh() {
        setInterval(() => {
            this.loadStats();
        }, this.STATS_REFRESH_INTERVAL);
    }

    // Utility to debounce function calls
    debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                // When calling the original function, ensure 'this' context is correct.
                // Using an arrow function for the setTimeout callback helps,
                // but applying the context explicitly is safer.
                func.apply(this, args);
            }, delay);
        };
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});