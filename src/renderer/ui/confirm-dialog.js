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
                e.preventDefault();
                this.close(true);
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
        
        if (danger) {
            this.confirmBtn.classList.add('danger');
        } else {
            this.confirmBtn.classList.remove('danger');
        }
        
        this.overlay.classList.add('active');
        this.dialog.classList.add('active');
        this.isOpen = true;
        
        this.confirmBtn.focus();
        
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }
    
    close(result) {
        this.overlay.classList.remove('active');
        this.dialog.classList.remove('active');
        this.isOpen = false;
        
        if (this.resolver) {
            this.resolver(result);
            this.resolver = null;
        }
    }
}

const confirmDialog = new ConfirmDialog();

window.showConfirmDialog = (options) => confirmDialog.show(options);
