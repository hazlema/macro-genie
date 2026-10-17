import { createMcpServer } from "../../mcp/server.js";
import { serveMcp } from "../../mcp/http.js";

export const config = { path: "/mcp" };

export default (request) => serveMcp(request, createMcpServer);
