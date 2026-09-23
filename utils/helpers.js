function formatRupiah(num) {
    return num.toLocaleString('id-ID');
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessageText(text, playerNames) {
    const escaped = escapeHtml(text);
    if (!playerNames || !playerNames.length) return escaped;
    const sorted = playerNames.slice().sort((a, b) => b.length - a.length);
    let result = escaped;
    for (const name of sorted) {
        const escName = escapeHtml(name);
        const re = new RegExp('@' + escName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        result = result.replace(re, '<span class="mention">@' + escName + '</span>');
    }
    return result;
}

module.exports = { formatRupiah, generateId, escapeHtml, formatMessageText };
