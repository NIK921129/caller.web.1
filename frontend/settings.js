// Import the shared APIClient module
import APIClient from './apiClient.js';

const apiBaseUrl = 'https://caller-web-1.onrender.com';
const api = new APIClient(`${apiBaseUrl}/api/v1`);
const authApi = new APIClient(apiBaseUrl); // For authentication routes like /auth/logout

class SettingsPage {
    constructor() {
        this.aiModelSelect = document.getElementById('ai-model');
        this.aiTemperatureInput = document.getElementById('ai-temperature');
        this.aiTemperatureValueSpan = document.getElementById('ai-temperature-value');
        this.promptTextarea = document.getElementById('ai-prompt');
        this.greetingTextarea = document.getElementById('ai-greeting');
        this.voiceSelect = document.getElementById('ai-voice');
        this.myPhoneNumberInput = document.getElementById('my-phone-number');
        this.callTimeoutInput = document.getElementById('call-timeout');
        this.saveButton = document.getElementById('save-settings-btn');
        this.statusMessage = document.getElementById('settings-status-message');

        // Connectivity Status Elements
        this.checkStatusBtn = document.getElementById('check-status-btn');
        this.dbStatusEl = document.getElementById('status-database');
        this.twilioStatusEl = document.getElementById('status-twilio');
        this.geminiStatusEl = document.getElementById('status-gemini');
        this.logoutBtn = document.getElementById('logout-btn');
        this.resetSettingsBtn = document.getElementById('reset-settings-btn');

        this.init();
    }

    init() {
        this.loadSettings();
        this.saveButton.addEventListener('click', () => this.saveSettings());
        this.resetSettingsBtn.addEventListener('click', () => this.resetSettings());
        this.aiTemperatureInput.addEventListener('input', (e) => {
            this.aiTemperatureValueSpan.textContent = e.target.value;
        });
        if (this.checkStatusBtn) {
            this.checkStatusBtn.addEventListener('click', () => this.checkConnectivity());
        }
        if (this.logoutBtn) {
            this.logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const response = await authApi.post('/auth/logout'); // Use authApi for logout
                    if (response.message === 'Logout successful.') {
                        window.location.href = '/login.html';
                    } else {
                        console.error('Logout failed:', response.message);
                    }
                } catch (error) {
                    console.error('Logout failed:', error);
                }
            });
        }
    }

    async loadSettings() {
        try {
            const settings = await api.get('/settings');
            this.promptTextarea.value = settings.ai_prompt || '';
            this.aiModelSelect.value = settings.ai_model || 'gemini-pro';
            this.aiTemperatureInput.value = settings.ai_temperature !== undefined ? settings.ai_temperature : '0.7';
            this.aiTemperatureValueSpan.textContent = this.aiTemperatureInput.value;
            this.greetingTextarea.value = settings.ai_greeting || "Hello, you've reached the AI assistant. Please state your name and the reason for your call after the beep.";
            this.voiceSelect.value = settings.ai_voice || 'Polly.Amy';
            this.myPhoneNumberInput.value = settings.my_phone_number || '';
            this.callTimeoutInput.value = settings.call_timeout || '10';
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.statusMessage.textContent = 'Error loading settings. Please refresh.';
            this.statusMessage.className = 'status-message error';
        }
    }

    async saveSettings() {
        if (!confirm('Are you sure you want to save these settings?')) {
            return;
        }
        const settingsToSave = {
            ai_prompt: this.promptTextarea.value,
            ai_greeting: this.greetingTextarea.value,
            ai_voice: this.voiceSelect.value,
            ai_model: this.aiModelSelect.value,
            my_phone_number: this.myPhoneNumberInput.value,
            call_timeout: this.callTimeoutInput.value
        };

        // Basic validation
        if (!/^\+[1-9]\d{1,14}$/.test(settingsToSave.my_phone_number)) {
            this.statusMessage.textContent = 'Please enter a valid phone number in E.164 format (e.g., +14155552671).';
            this.statusMessage.className = 'status-message error';
            return;
        }
        const timeout = parseInt(settingsToSave.call_timeout, 10);
        if (isNaN(timeout) || timeout < 5 || timeout > 60) {
            this.statusMessage.textContent = 'Call Timeout must be between 5 and 60 seconds.';
            this.statusMessage.className = 'status-message error';
            return;
        }
        const temperature = parseFloat(settingsToSave.ai_temperature);
        if (isNaN(temperature) || temperature < 0.0 || temperature > 1.0) {
            this.statusMessage.textContent = 'AI Temperature must be between 0.0 and 1.0.';
            this.statusMessage.className = 'status-message error';
            return;
        }
        const maxTokens = parseInt(settingsToSave.ai_max_tokens, 10);
        if (isNaN(maxTokens) || maxTokens < 1 || maxTokens > 2048) {
            this.statusMessage.textContent = 'AI Max Response Tokens must be between 1 and 2048.';
            this.statusMessage.className = 'status-message error';
            return;
        }
        settingsToSave.ai_temperature = temperature; // Ensure float
        settingsToSave.ai_max_tokens = maxTokens; // Ensure int

        this.saveButton.textContent = 'Saving...';
        this.saveButton.disabled = true;
        this.statusMessage.textContent = '';
        this.statusMessage.className = 'status-message';

        try {
            await api.put('/settings', settingsToSave);
            this.statusMessage.textContent = 'Settings saved successfully!';
            this.statusMessage.className = 'status-message success';
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.statusMessage.textContent = 'Failed to save settings.';
            this.statusMessage.className = 'status-message error';
        } finally {
            this.saveButton.textContent = 'Save All Settings';
            this.saveButton.disabled = false;
            setTimeout(() => {
                this.statusMessage.textContent = '';
                this.statusMessage.className = 'status-message';
            }, 3000);
        }
    }

    async resetSettings() {
        if (!confirm('Are you sure you want to reset all settings to their default values? This cannot be undone.')) {
            return;
        }

        this.resetSettingsBtn.textContent = 'Resetting...';
        this.resetSettingsBtn.disabled = true;
        this.saveButton.disabled = true; // Disable save button too
        this.statusMessage.textContent = '';
        this.statusMessage.className = 'status-message';

        try {
            // Send a request to the backend to clear these settings from the DB
            // The backend will then use config.js defaults
            await api.delete('/settings/all'); // New API endpoint to clear all settings
            this.statusMessage.textContent = 'Settings reset to defaults successfully!';
            this.statusMessage.className = 'status-message success';
            await this.loadSettings(); // Reload to show default values
        } catch (error) {
            console.error('Failed to reset settings:', error);
            this.statusMessage.textContent = 'Failed to reset settings.';
            this.statusMessage.className = 'status-message error';
        } finally {
            this.resetSettingsBtn.textContent = 'Reset to Defaults';
            this.resetSettingsBtn.disabled = false;
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
            el.innerHTML = `<span class="status-badge checking">Checking...</span>`;
        });

        try {
            const statuses = await api.get('/health/status');
            for (const [service, data] of Object.entries(statuses)) {
                if (statusElements[service]) {
                    const statusClass = data.status === 'ok' ? 'status-ok' : 'status-error';
                    statusElements[service].innerHTML = `<span class="status-badge ${statusClass}">${data.message}</span>`;
                }
            }
        } catch (error) {
            // The fetch itself can fail, or the API returns a 503 which is caught here
            console.error('Failed to fetch connectivity status:', error);
            Object.values(statusElements).forEach(el => {
                el.innerHTML = `<span class="status-badge status-error">Failed to get status</span>`;
            });
        } finally {
            this.checkStatusBtn.textContent = 'Check Status';
            this.checkStatusBtn.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new SettingsPage());