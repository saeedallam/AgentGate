import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentGateMcpServer } from './server.js';

async function main() {
  // No dotenv import: its banner would corrupt stdout, which is the MCP protocol.
  const server = createAgentGateMcpServer(process.env);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 }));
  process.once('SIGINT', () => { void server.close(); });
  process.once('SIGTERM', () => { void server.close(); });
}
main().catch(() => { console.error('AgentGate MCP could not start. Check the operator-supplied configuration.'); process.exitCode = 1; });
