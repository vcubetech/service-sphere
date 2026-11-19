export function notFound(req, res) { res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` }); }
export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message, ...(process.env.NODE_ENV === 'development' ? { detail: err.message } : {}) });
}
