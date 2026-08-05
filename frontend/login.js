// frontend/login.js
import APIClient from './apiClient.js';

const apiBaseUrl = window.location.origin;
const api = new APIClient(apiBaseUrl);

class LoginPage {
    constructor() {
        this.form = document.getElementById('login-form');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.errorMessage = document.getElementById('error-message');
        this.passwordToggle = document.getElementById('password-toggle');
        this.init();
    }

    init() {
        // Check if already logged in
        this.checkAuth();

        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleLogin();
        });

        this.passwordToggle.addEventListener('click', () => {
            const type = this.passwordInput.type === 'password' ? 'text' : 'password';
            this.passwordInput.type = type;
            this.passwordToggle.querySelector('i').className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        });

        // Enter key submit is handled by form submit
    }

    async checkAuth() {
        try {
            const status = await api.get('/auth/status');
            if (status.authenticated) {
                window.location.href = '/';
            }
        } catch (error) {
            // Not authenticated, stay on login page
        }
    }

    async handleLogin() {
        this.errorMessage.textContent = '';
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value;

        if (!username || !password) {
            this.errorMessage.textContent = 'Please enter both username and password.';
            return;
        }

        try {
            const result = await api.post('/auth/login', { username, password });
            if (result.message === 'Login successful') {
                window.location.href = '/';
            }
        } catch (error) {
            this.errorMessage.textContent = error.message || 'Invalid username or password.';
            this.passwordInput.value = '';
            this.passwordInput.focus();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new LoginPage());