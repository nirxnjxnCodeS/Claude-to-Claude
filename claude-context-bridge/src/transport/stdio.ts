import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type BridgeOptions, createMCPServer } from '../server.js';

export async function startStdioTransport(options: BridgeOptions): Promise<void> {
  const server = createMCPServer(options);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  // Process stays alive via stdin — MCP protocol runs until client disconnects
}
