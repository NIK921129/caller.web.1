// frontend/apiClient.js
export default class APIClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
    }

    async get(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            credentials: 'include'
        });
        if (response.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        return response.json();
    }

    async post(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'include'
        });
        if (response.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `API Error: ${response.status}` }));
            throw new Error(errorData.message);
        }
        return response.json();
    }

    async put(endpoint, data) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'include'
        });
        if (response.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        return response.json();
    }

    async delete(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (response.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Unauthorized');
        }
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        return response.json();
    }
}