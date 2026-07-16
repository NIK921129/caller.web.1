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
        this.init();
    }

    init() {
        this.loadPrompt();
        this.saveButton.addEventListener('click', () => this.savePrompt());
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
}

document.addEventListener('DOMContentLoaded', () => new SettingsPage());