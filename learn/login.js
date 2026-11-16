document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const status = document.querySelector('#login-status');
    button.disabled = true;
    status.textContent = '正在进入…';
    try {
        const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Atlas-Request': '1' },
            body: JSON.stringify({ accessCode: document.querySelector('#access-code').value.trim() }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '登录失败');
        document.querySelector('#access-code').value = '';
        location.replace('/learn/index.html');
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});
