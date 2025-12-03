function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-mode');
    
    const isLightMode = body.classList.contains('light-mode');
    localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
    updateThemeIcon();
}

function updateThemeIcon() {
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        const isLightMode = document.body.classList.contains('light-mode');
        themeIcon.textContent = isLightMode ? 'dark_mode' : 'light_mode';
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    
    if (savedTheme === 'light' || (!savedTheme && prefersLight)) {
        document.body.classList.add('light-mode');
    }
    
    updateThemeIcon();
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', initTheme);
