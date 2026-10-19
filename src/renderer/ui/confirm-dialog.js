/**
 * Custom Confirm Dialog
 * Promise-based alternative to native confirm() with better UX
 */

class ConfirmDialog {
    constructor() {
        this.overlay = document.getElementById('confirm-dialog-overlay');
        this.dialog = document.getElementById('confirm-dialog');
        this.title = document.getElementById('confirm-dialog-title');
        this.message = document.getElementById('confirm-dialog-message');
        this.cancelBtn = document.getElementById('confirm-dialog-cancel');
        this.confirmBtn = document.getElementById('confirm-dialog-confirm');
        
        this.resolver = null;
        this.isOpen = false;
        this.previouslyFocusedEl = null;
        
        this.initializeEvents();
    }
    
    initializeEvents() {
        this.overlay.addEventListener('click', () => this.close(false));
        
        this.cancelBtn.addEventListener('click', () => this.close(false));
        
        this.confirmBtn.addEventListener('click', () => this.close(true));
        
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;
            
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close(false);
            } else if (e.key === 'Enter') {
                // Enter answers with the focused button: Tab to Cancel, then Enter, must not
                // confirm a deletion.
                e.preventDefault();
                this.close(document.activeElement !== this.cancelBtn);
            }
        });
    }
    
    show(options = {}) {
        const {
            title = 'Confirm Action',
            message = 'Are you sure?',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            danger = false
        } = options;
        
        this.title.textContent = title;
        this.message.textContent = message;
        this.confirmBtn.textContent = confirmText;
        this.cancelBtn.textContent = cancelText;
        
        this.confirmBtn.classList.toggle('danger', !!danger);
        this.dialog.classList.toggle('danger', !!danger);
        
        this.overlay.classList.add('active');
        this.dialog.classList.add('active');
        this.isOpen = true;

        this.previouslyFocusedEl = document.activeElement;
        try { this.previouslyFocusedEl?.blur?.(); } catch (_) {}

        const result = new Promise((resolve) => {
            this.resolver = resolve;
        });
        window.focus();
        this.confirmBtn.focus();
        return result;
    }
    
    close(result) {
        this.overlay.classList.remove('active');
        this.dialog.classList.remove('active');
        this.isOpen = false;

        const restoreTarget = this.previouslyFocusedEl;
        this.previouslyFocusedEl = null;
        const resolve = this.resolver;
        this.resolver = null;
        if (restoreTarget && typeof restoreTarget.focus === 'function') {
            try { restoreTarget.focus(); } catch (_) {}
        }
        
        if (resolve) resolve(result);
    }
}

const confirmDialog = new ConfirmDialog();

window.showConfirmDialog = (options) => confirmDialog.show(options);
