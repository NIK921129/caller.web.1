class APIClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async get(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    }

    async put(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    }
}

const apiBaseUrl = 'https://caller-web-1.onrender.com';
const api = new APIClient(`${apiBaseUrl}/api/v1`);

class SettingsPage {
    constructor() {
        this.promptTextarea = document.getElementById('ai-prompt');
        this.saveButton = document.getElementById('save-prompt-btn');
        this.statusMessage = document.getElementById('status-message');

        // Connectivity Status Elements
        this.checkStatusBtn = document.getElementById('check-status-btn');
        this.dbStatusEl = document.getElementById('status-database');
        this.twilioStatusEl = document.getElementById('status-twilio');
        this.geminiStatusEl = document.getElementById('status-gemini');

        this.init();
    }

    init() {
        this.loadPrompt();
        this.saveButton.addEventListener('click', () => this.savePrompt());
        if (this.checkStatusBtn) {
            this.checkStatusBtn.addEventListener('click', () => this.checkConnectivity());
        }
    }

    async loadPrompt() {
        try {
            const data = await api.get('/settings/prompt');
            this.promptTextarea.value = data.prompt || '';
        } catch (error) {
            console.error('Failed to load prompt:', error);
            this.statusMessage.textContent = 'Error loading prompt.';
            this.statusMessage.className = 'error';
        }
    }

    async savePrompt() {
        const newPrompt = this.promptTextarea.value;
        this.saveButton.textContent = 'Saving...';
        this.saveButton.disabled = true;
        try {
            await api.put('/settings/prompt', { prompt: newPrompt });
            this.statusMessage.textContent = 'Prompt saved successfully!';
            this.statusMessage.className = 'success';
        } catch (error) {
            this.statusMessage.textContent = 'Failed to save prompt.';
            this.statusMessage.className = 'error';
        } finally {
            this.saveButton.textContent = 'Save Prompt';
            this.saveButton.disabled = false;
            setTimeout(() => this.statusMessage.textContent = '', 3000);
        }
    }

    async checkConnectivity() {
        this.checkStatusBtn.textContent = 'Checking...';
        this.checkStatusBtn.disabled = true;

        const statusElements = {
            database: this.dbStatusEl,
            twilio: this.twilioStatusEl,
            gemini: this.geminiStatusEl,
        };

        // Reset statuses
        Object.values(statusElements).forEach(el => {
            el.innerHTML = `<span class="status-checking">Checking...</span>`;
        });

        try {
            const statuses = await api.get('/health/status');
            for (const [service, data] of Object.entries(statuses)) {
                if (statusElements[service]) {
                    const statusClass = data.status === 'ok' ? 'status-ok' : 'status-error';
                    statusElements[service].innerHTML = `<span class="${statusClass}">${data.message}</span>`;
                }
            }
        } catch (error) {
            // The fetch itself can fail, or the API returns a 503 which is caught here
            console.error('Failed to fetch connectivity status:', error);
            Object.values(statusElements).forEach(el => {
                el.innerHTML = `<span class="status-error">Failed to get status</span>`;
            });
        } finally {
            this.checkStatusBtn.textContent = 'Check Status';
            this.checkStatusBtn.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new SettingsPage());