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
        this.totalCallsEl = document.getElementById('total-calls');
        this.aiHandledEl = document.getElementById('ai-handled');
        this.avgDurationEl = document.getElementById('avg-duration');
        this.todayCallsEl = document.getElementById('today-calls');
        this.tableContainer = document.querySelector('.conversations');
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
            this.totalCallsEl.textContent = stats.total_calls ?? 0;
            this.aiHandledEl.textContent = stats.ai_handled ?? 0;
            this.avgDurationEl.textContent = stats.avg_duration ?? '0:00';
            this.todayCallsEl.textContent = stats.last_24h ?? 0;
        } catch (error) {
            console.error('Error loading stats:', error);
            // Optionally, show an error state on the cards
            [this.totalCallsEl, this.aiHandledEl, this.avgDurationEl, this.todayCallsEl].forEach(el => el.textContent = 'Error');
        }
    }

    async loadConversations(append = false) {
        if (!append) {
            this.showLoading();
        }
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
            this.loadMoreBtn.style.display = data.total > (this.currentPage * this.limit) ? 'block' : 'none';

        } catch (error) {
            console.error('Error loading conversations:', error);
            this.showError('Failed to load conversations. Please try again.');
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
        const startIndex = (this.currentPage - 1) * this.limit;
        
        const fragment = document.createDocumentFragment();
        conversations.map((conv, index) => this.createConversationRow(conv, startIndex + index))
            .forEach(row => fragment.appendChild(row));
        
        this.conversationsBody.appendChild(fragment);
    }

    createConversationRow(conv, index) {
        const status = conv.status || 'unknown';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${this.formatCaller(conv.caller_number)}</td>
            <td>${this.formatDate(conv.start_time)}</td>
            <td>${this.formatDuration(conv.duration_seconds)}</td>
            <td><span class="status-badge status-${status.replace(' ', '_')}">${status.replace('_', ' ').toUpperCase()}</span></td>
            <td><button class="btn-view" data-id="${conv._id}">View</button></td>
        `;
        return row;
    }

    async viewConversation(conversationId) {
        this.conversationDetailContainer.innerHTML = '<p>Loading details...</p>';
        this.openModal();
        try {
            const conversation = await api.get(`/conversations/${conversationId}`);
            this.renderConversationDetail(conversation);
        } catch (error) {
            console.error('Error loading conversation:', error);
            this.conversationDetailContainer.innerHTML = '<p class="error-message">Failed to load conversation details.</p>';
        }
    }

    renderConversationDetail(conversation) {
        this.conversationDetailContainer.innerHTML = `
            <h2>Conversation Details</h2>
            <div class="call-info">
                <p><strong>Caller:</strong> ${this.formatCaller(conversation.caller_number)}</p>
                <p><strong>Date:</strong> ${this.formatDate(conversation.start_time)}</p>
                <p><strong>Duration:</strong> ${this.formatDuration(conversation.duration_seconds ?? 0)}</p>
                <p><strong>Status:</strong> ${conversation.status || 'N/A'}</p>
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
                ${(conversation.transcript || []).map(entry => `
                    <div class="message ${entry.speaker}">
                        <span class="speaker">${entry.speaker === 'caller' ? '👤 Caller' : '🤖 AI Agent'}</span>
                        <span class="time">${this.formatTime(entry.timestamp)}</span>
                        <p>${entry.text}</p>
                    </div>
                `).join('')}
            </div>
        `;
    }

    openModal() {
        this.conversationModal.classList.add('active');
    }

    closeModal() {
        this.conversationModal.classList.remove('active');
    }

    formatCaller(number) {
        if (!number) return 'Unknown';
        const cleaned = ('' + number).replace(/\D/g, '');
        const match = cleaned.match(/^(1|)?(\d{3})(\d{3})(\d{4})$/);
        if (match) {
            return `+1 (${match[2]}) ${match[3]}-${match[4]}`;
        }
        return number;
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
        if (seconds === null || seconds === undefined) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
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

    showLoading() {
        this.conversationsBody.innerHTML = '<tr class="loading-row"><td colspan="6" style="text-align:center;padding:40px;">Loading...</td></tr>';
        this.loadMoreBtn.style.display = 'none';
    }

    showError(message) {
        this.conversationsBody.innerHTML = `<tr class="error-row"><td colspan="6" style="text-align:center;padding:40px;color:red;">${message}</td></tr>`;
        this.loadMoreBtn.style.display = 'none';
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});