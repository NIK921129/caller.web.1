// frontend/script.js
import APIClient from './apiClient.js';

const apiBaseUrl = window.location.origin;
const api = new APIClient(`${apiBaseUrl}/api/v1`);
const authApi = new APIClient(apiBaseUrl);

class Dashboard {
    constructor() {
        this.currentPage = 1;
        this.limit = 20;
        this.filters = {
            search: '',
            fromDate: '',
            toDate: '',
            status: 'all'
        };
        this.STATS_REFRESH_INTERVAL = 30000;
        this.SEARCH_DEBOUNCE_DELAY = 400;
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
        this.clearFiltersBtn = document.getElementById('clear-filters-btn');
        this.conversationModal = document.getElementById('conversation-modal');
        this.modalCloseBtn = document.querySelector('.modal-close');
        this.conversationsBody = document.getElementById('conversations-body');
        this.conversationDetail = document.getElementById('conversation-detail');
        this.totalCallsEl = document.getElementById('total-calls');
        this.aiHandledEl = document.getElementById('ai-handled');
        this.avgDurationEl = document.getElementById('avg-duration');
        this.todayCallsEl = document.getElementById('today-calls');
        this.statsLastUpdatedEl = document.getElementById('stats-last-updated');
        this.resultCountEl = document.getElementById('result-count');
        this.currentTimeEl = document.getElementById('current-time');
        this.logoutBtn = document.getElementById('logout-btn');
    }

    init() {
        this.setupEventListeners();
        this.loadStats();
        this.loadConversations();
        this.startAutoRefresh();
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const now = new Date();
        this.currentTimeEl.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    setupEventListeners() {
        this.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value;
            this.currentPage = 1;
            this.debouncedLoadConversations();
        });

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

        this.statusFilter.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.currentPage = 1;
            this.loadConversations();
        });

        this.refreshBtn.addEventListener('click', () => {
            this.refreshBtn.classList.add('spinning');
            this.loadStats();
            this.loadConversations();
            setTimeout(() => this.refreshBtn.classList.remove('spinning'), 500);
        });

        this.loadMoreBtn.addEventListener('click', () => {
            this.currentPage++;
            this.loadConversations(true);
        });

        this.clearFiltersBtn.addEventListener('click', () => {
            this.resetFilters();
            this.currentPage = 1;
            this.loadConversations();
        });

        this.modalCloseBtn.addEventListener('click', () => this.closeModal());
        this.conversationModal.addEventListener('click', (e) => {
            if (e.target === this.conversationModal) this.closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });

        this.conversationsBody.addEventListener('click', (e) => {
            const viewButton = e.target.closest('.btn-view');
            if (viewButton) this.viewConversation(viewButton.dataset.id);
        });

        this.logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await authApi.post('/auth/logout');
                window.location.href = '/login.html';
            } catch (error) {
                console.error('Logout failed:', error);
            }
        });
    }

    resetFilters() {
        this.filters = {
            search: '',
            fromDate: '',
            toDate: '',
            status: 'all'
        };
        this.searchInput.value = '';
        this.dateFromInput.value = '';
        this.dateToInput.value = '';
        this.statusFilter.value = 'all';
    }

    async loadStats() {
        try {
            const stats = await api.get('/conversations/stats');
            this.totalCallsEl.textContent = stats.total_calls ?? 0;
            this.aiHandledEl.textContent = stats.ai_handled ?? 0;
            this.avgDurationEl.textContent = stats.avg_duration ?? '0:00';
            this.todayCallsEl.textContent = stats.last_24h ?? 0;
            this.statsLastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        } catch (error) {
            console.error('Error loading stats:', error);
            [this.totalCallsEl, this.aiHandledEl, this.avgDurationEl, this.todayCallsEl]
                .forEach(el => el.textContent = 'Error');
        }
    }

    async loadConversations(append = false) {
        if (!append) this.showLoading();

        try {
            const params = new URLSearchParams({
                limit: this.limit,
                offset: (this.currentPage - 1) * this.limit,
                search: this.filters.search,
                from_date: this.filters.fromDate,
                to_date: this.filters.toDate,
                status: this.filters.status
            });

            const data = await api.get(`/conversations?${params}`);
            
            if (append) {
                this.appendConversations(data.conversations);
            } else {
                this.renderConversations(data.conversations);
            }

            const total = data.total || 0;
            this.resultCountEl.textContent = `${total} conversation${total !== 1 ? 's' : ''}`;
            this.loadMoreBtn.style.display = total > this.currentPage * this.limit ? 'flex' : 'none';

        } catch (error) {
            console.error('Error loading conversations:', error);
            this.showError('Failed to load conversations. Please try again.');
        }
    }

    renderConversations(conversations) {
        if (!conversations || conversations.length === 0) {
            this.conversationsBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center;padding:3rem;color:var(--text-secondary);">
                        <i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:0.5rem;"></i>
                        No conversations found
                    </td>
                </tr>
            `;
            return;
        }
        this.conversationsBody.innerHTML = '';
        this.appendConversations(conversations);
    }

    appendConversations(conversations) {
        const startIndex = (this.currentPage - 1) * this.limit;
        const fragment = document.createDocumentFragment();
        
        conversations.forEach((conv, index) => {
            fragment.appendChild(this.createConversationRow(conv, startIndex + index + 1));
        });
        
        this.conversationsBody.appendChild(fragment);
    }

    createConversationRow(conv, index) {
        const status = conv.status || 'unknown';
        const sentiment = conv.sentiment || 'neutral';
        const row = document.createElement('tr');
        
        row.innerHTML = `
            <td>${index}</td>
            <td><span class="caller-number">${this.formatCaller(conv.caller_number)}</span></td>
            <td>${this.formatDate(conv.start_time)}</td>
            <td>${this.formatDuration(conv.duration_seconds)}</td>
            <td><span class="status-badge status-${status.replace(' ', '_')}">${status.replace('_', ' ').toUpperCase()}</span></td>
            <td><span class="sentiment-badge sentiment-${sentiment.toLowerCase()}">${sentiment || '—'}</span></td>
            <td><button class="btn-view" data-id="${conv._id}"><i class="fas fa-eye"></i> View</button></td>
        `;
        return row;
    }

    async viewConversation(conversationId) {
        this.openModal();
        this.conversationDetail.innerHTML = `
            <div class="loading-spinner">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading conversation...</p>
            </div>
        `;

        try {
            const conversation = await api.get(`/conversations/${conversationId}`);
            this.renderConversationDetail(conversation);
        } catch (error) {
            console.error('Error loading conversation:', error);
            this.conversationDetail.innerHTML = `
                <p style="color:#f87171;text-align:center;padding:2rem;">
                    <i class="fas fa-exclamation-circle"></i> Failed to load conversation details.
                </p>
            `;
        }
    }

    renderConversationDetail(conversation) {
        const formattedCaller = this.formatCaller(conversation.caller_number);
        const transcript = conversation.transcript || [];
        const hasSummary = conversation.summary || conversation.sentiment || (conversation.topics && conversation.topics.length > 0);

        let summaryHTML = '';
        if (hasSummary) {
            summaryHTML = `
                <div class="summary-box">
                    <h3><i class="fas fa-robot"></i> AI Summary</h3>
                    ${conversation.summary ? `<p>${conversation.summary}</p>` : ''}
                    ${conversation.sentiment ? `<p style="margin-top:0.5rem;"><strong>Sentiment:</strong> <span class="sentiment-badge sentiment-${conversation.sentiment.toLowerCase()}">${conversation.sentiment}</span></p>` : ''}
                    ${conversation.topics && conversation.topics.length > 0 ? `<p style="margin-top:0.5rem;"><strong>Topics:</strong> ${conversation.topics.map(t => `<span class="topic-tag">${t}</span>`).join(' ')}</p>` : ''}
                </div>
            `;
        }

        this.conversationDetail.innerHTML = `
            <div class="conversation-detail">
                <div class="call-info">
                    <p><strong><i class="fas fa-phone"></i> Call SID:</strong> ${conversation.callSid || 'N/A'}</p>
                    <p><strong><i class="fas fa-user"></i> Caller:</strong> ${formattedCaller} 
                        <button class="copy-btn" data-number="${conversation.caller_number}" title="Copy number">
                            <i class="fas fa-copy"></i>
                        </button>
                    </p>
                    <p><strong><i class="fas fa-calendar"></i> Date:</strong> ${this.formatDate(conversation.start_time)}</p>
                    <p><strong><i class="fas fa-clock"></i> Duration:</strong> ${this.formatDuration(conversation.duration_seconds ?? 0)}</p>
                    <p><strong><i class="fas fa-tag"></i> Status:</strong> <span class="status-badge status-${conversation.status || 'unknown'}">${(conversation.status || 'unknown').toUpperCase()}</span></p>
                    <p><strong><i class="fas fa-comment"></i> Messages:</strong> ${transcript.length}</p>
                </div>

                ${summaryHTML}

                <div class="transcript">
                    <h3><i class="fas fa-list-ul"></i> Transcript</h3>
                    ${transcript.length > 0 ? transcript.map(entry => `
                        <div class="message ${entry.speaker}">
                            <div class="speaker">
                                ${entry.speaker === 'caller' ? '<i class="fas fa-user caller-icon"></i>' : '<i class="fas fa-robot ai-icon"></i>'}
                                ${entry.speaker === 'caller' ? 'Caller' : 'AI Agent'}
                                <span class="time">${this.formatTime(entry.timestamp)}</span>
                            </div>
                            <div class="text">${this.escapeHtml(entry.text)}</div>
                        </div>
                    `).join('') : '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No transcript available.</p>'}
                </div>
            </div>
        `;

        // Copy button handler
        this.conversationDetail.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
            const number = e.currentTarget.dataset.number;
            try {
                await navigator.clipboard.writeText(number);
                const icon = e.currentTarget.querySelector('i');
                icon.className = 'fas fa-check';
                setTimeout(() => icon.className = 'fas fa-copy', 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    openModal() {
        this.conversationModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        this.conversationModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    formatCaller(number) {
        if (!number) return 'Unknown';
        const cleaned = String(number).replace(/\D/g, '');
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
        setInterval(() => this.loadStats(), this.STATS_REFRESH_INTERVAL);
    }

    debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    showLoading() {
        this.conversationsBody.innerHTML = `
            ${Array(5).fill(0).map(() => `
                <tr class="skeleton-row">
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                    <td><div class="skeleton"></div></td>
                </tr>
            `).join('')}
        `;
        this.loadMoreBtn.style.display = 'none';
    }

    showError(message) {
        this.conversationsBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center;padding:2rem;color:#f87171;">
                    <i class="fas fa-exclamation-circle" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>
                    ${message}
                </td>
            </tr>
        `;
        this.loadMoreBtn.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => new Dashboard());