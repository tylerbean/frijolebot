const http = require('http');
const { createProxyServer } = require('http-proxy');

const UI_PORT = process.env.UI_PORT || 3100;
const BOT_PORT = process.env.BOT_PORT || 3001;
const PORT = process.env.PORT || 3000;

const proxy = createProxyServer({
  xfwd: true,
  changeOrigin: true,
  proxyTimeout: 30_000,
  timeout: 30_000,
});

function proxyTo(targetPort, req, res, opts = {}) {
  proxy.web(req, res, { target: `http://127.0.0.1:${targetPort}`, ...opts }, (err) => {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Bad Gateway', detail: err?.message }));
  });
}

const server = http.createServer((req, res) => {
  // Basic hardening
  req.socket.setTimeout(30_000);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  const url = req.url || '/';
  // Health endpoints → bot
  if (url === '/health' || url.startsWith('/health/')) {
    return proxyTo(BOT_PORT, req, res);
  }
  // Bot endpoints under /api/bot/* → strip prefix and send to bot
  if (url.startsWith('/api/bot/')) {
    req.url = url.replace('/api/bot', '');
    return proxyTo(BOT_PORT, req, res);
  }
  // Everything else (/, /api/*, assets) → Next.js UI
  return proxyTo(UI_PORT, req, res);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[gateway] listening on ${PORT} → UI:${UI_PORT} BOT:${BOT_PORT}`);
});


