import { randomUUID } from 'crypto';
import express from 'express';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Response } from 'express';

// Minimal Transport interface — matches the MCP SDK's structural requirement
interface Transport {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
}

/**
 * Custom SSE transport backed by a live Express response stream.
 *
 * The MCP Server calls send() to push responses; POST /messages calls
 * injectMessage() to deliver inbound JSON-RPC payloads. No SDK stream
 * reading — express.json() owns the request body parsing.
 */
class SSESessionTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly sseRes: Response) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  // MCP Server → client: write a JSON-RPC response/notification as SSE data event
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.sseRes.writableEnded) {
      throw new Error('[SSE] Attempted write to closed stream');
    }
    this.sseRes.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  // POST /messages → MCP Server: deliver an inbound JSON-RPC message
  injectMessage(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

interface Session {
  transport: SSESessionTransport;
}

// Module-level — one map for the process lifetime, no per-request state
const sessions = new Map<string, Session>();

export function startSSEServer(port: number, serverFactory: () => Server): void {
  const app = express();
  app.use(express.json());

  // CORS on every response — required for Chrome extension → localhost
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.options('*', (_req, res) => {
    res.sendStatus(204);
  });

  // ── GET /sse ─────────────────────────────────────────────────────────────
  // Opens the long-lived SSE stream. Sends ONE `endpoint` event so the client
  // knows where to POST messages. All MCP responses travel back on this stream.
  app.get('/sse', async (_req, res) => {
    const sessionId = randomUUID();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Create transport — backed by this response stream
    const transport = new SSESessionTransport(res);

    // Register BEFORE sending the endpoint event so the session exists
    // the moment the client reads the sessionId and tries to POST
    sessions.set(sessionId, { transport });
    console.error(`[SSE] Session opened: ${sessionId} (active: ${sessions.size})`);

    // Wire up the MCP Server — sets transport.onmessage internally
    const server = serverFactory();
    await server.connect(transport);

    // Keep-alive ping every 15 s — resets proxy/browser idle timers
    const ping = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      } else {
        clearInterval(ping);
      }
    }, 15_000);

    res.on('close', () => {
      clearInterval(ping);
      sessions.delete(sessionId);
      transport.onclose?.();
      console.error(`[SSE] Session closed: ${sessionId} (active: ${sessions.size})`);
    });

    // Tell the client where to POST — send AFTER connect so onmessage is wired
    res.write(
      `event: endpoint\ndata: /messages?sessionId=${encodeURIComponent(sessionId)}\n\n`
    );
  });

  // ── POST /messages ───────────────────────────────────────────────────────
  // Client sends JSON-RPC requests here. Body is already parsed by express.json().
  // We inject it into the transport; the MCP Server responds via the SSE stream.
  app.post('/messages', (req, res) => {
    const sessionId = req.query['sessionId'] as string | undefined;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        error: `Session "${sessionId}" not found — reconnect via GET /sse`,
        active_sessions: sessions.size,
      });
      return;
    }

    // Inject — server processes synchronously and calls transport.send()
    // to write the response back over the SSE stream
    session.transport.injectMessage(req.body as JSONRPCMessage);

    // 202: acknowledged. Actual response arrives via the SSE data event.
    res.status(202).end();
  });

  // ── GET /health ──────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      active_sessions: sessions.size,
      session_ids: [...sessions.keys()],
    });
  });

  app.listen(port, () => {
    console.error(`[Bridge] SSE    → http://localhost:${port}/sse`);
    console.error(`[Bridge] POST   → http://localhost:${port}/messages?sessionId=<id>`);
    console.error(`[Bridge] Health → http://localhost:${port}/health`);
  });
}
