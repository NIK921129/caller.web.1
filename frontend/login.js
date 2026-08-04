class APIClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async post(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `API Error: ${response.status}` }));
            throw new Error(errorData.message);
        }
        return response.json();
    }
}

const apiBaseUrl = 'https://caller-web-1.onrender.com';
const api = new APIClient(apiBaseUrl);

class LoginPage {
    constructor() {
        this.form = document.getElementById('login-form');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.errorMessage = document.getElementById('error-message');
        this.init();
    }

    init() {
        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleLogin();
        });
    }

    async handleLogin() {
        this.errorMessage.textContent = '';
        const username = this.usernameInput.value;
        const password = this.passwordInput.value;

        try {
            await api.post('/auth/login', { username, password });
            window.location.href = '/'; // Redirect to dashboard on success
        } catch (error) {
            this.errorMessage.textContent = error.message || 'Invalid username or password.';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new LoginPage());