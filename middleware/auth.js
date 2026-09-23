function requireLogin(req, res, next) {
    if (!req.session?.user) {
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session?.admin) {
        return res.redirect('/admin/login');
    }
    next();
}

module.exports = { requireLogin, requireAdmin };
