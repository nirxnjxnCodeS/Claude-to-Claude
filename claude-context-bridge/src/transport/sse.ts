import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { type BridgeOptions, createMCPServer } from '../server.js';

export function startSSEServer(port: number, options: BridgeOptions): void {
  const app = express();
  app.use(express.json());

  // CORS for MCP Bridge Chrome extension
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // Map of sessionId -> active transport
  const transports = new Map<string, SSEServerTransport>();

  // SSE endpoint — browser/extension connects here
  app.get('/sse', async (_req, res) => {
    console.error('[SSE] New client connected');

    const transport = new SSEServerTransport('/messages', res);
    const server = createMCPServer(options);

    // Store by sessionId once available
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    res.on('close', () => {
      console.error(`[SSE] Client disconnected (session ${sessionId})`);
      transports.delete(sessionId);
    });

    try {
      await server.connect(transport);
    } catch (err) {
      console.error('[SSE] Connection error:', err);
      transports.delete(sessionId);
    }
  });

  // Pre-flight
  app.options('/messages', (_req, res) => {
    res.sendStatus(204);
  });

  // Message endpoint — SSE client POSTs inbound messages here
  app.post('/messages', async (req, res) => {
    const sessionId = req.query['sessionId'] as string | undefined;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({
        error: `Session "${sessionId}" not found. Connect via GET /sse first.`,
      });
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error('[SSE] Error handling message:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      active_sessions: transports.size,
      server: 'claude-context-bridge',
    });
  });

  app.listen(port, () => {
    console.error(`[Bridge] SSE server listening on http://localhost:${port}`);
    console.error(`[Bridge]   SSE endpoint : http://localhost:${port}/sse`);
    console.error(`[Bridge]   Message post : http://localhost:${port}/messages`);
    console.error(`[Bridge]   Health check : http://localhost:${port}/health`);
  });
}
