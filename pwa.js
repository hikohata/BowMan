// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => console.log('Service Worker Registered', reg))
            .catch((err) => console.log('Service Worker Registration Failed', err));
    });
}

// PWA Install Prompt Logic
document.addEventListener('DOMContentLoaded', () => {
    let deferredPrompt;
    const banner = document.getElementById('pwa-install-banner');
    const installBtn = document.getElementById('pwa-install-btn');
    const closeBtn = document.getElementById('pwa-close-btn');

    if (!banner || !installBtn || !closeBtn) return;

    // Check if app is already installed (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) {
        return; // Do nothing if already installed
    }

    // Handle beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default browser install prompt
        e.preventDefault();

        // PWA Install Prompt Logic - Mobile Only
        // Check user agent for mobile devices
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (!isMobile) {
            console.log("PWA Install Banner skipped on Desktop");
            return;
        }

        // Stash the event so it can be triggered later
        deferredPrompt = e;
        // Show the banner
        banner.classList.remove('hidden');
        banner.classList.add('visible');
    });

    // Firefox Android Specific Logic (No beforeinstallprompt support)
    const isFirefoxAndroid = /Android/i.test(navigator.userAgent) && /Firefox/i.test(navigator.userAgent);
    if (isFirefoxAndroid) {
        setTimeout(() => {
            banner.classList.remove('hidden');
            banner.classList.add('visible');
            
            // Adjust UI for manual install
            installBtn.style.display = 'none';
            const desc = banner.querySelector('.pwa-desc');
            if (desc) desc.innerText = "Menu > Install";
        }, 3000);
    }

    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            // We've used the prompt, and can't use it again, discard it
            deferredPrompt = null;
            // Hide the banner
            banner.classList.remove('visible');
            banner.classList.add('hidden');
        }
    });

    closeBtn.addEventListener('click', () => {
        banner.classList.remove('visible');
        banner.classList.add('hidden');
    });
});
