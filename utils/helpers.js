function formatRupiah(num) {
    return num.toLocaleString('id-ID');
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

module.exports = { formatRupiah, generateId };
