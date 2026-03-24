import type { Tool } from './types.js';
import { createBashExecTool } from './tools/bash-exec.js';

/**
 * Registry for managing tools available to the LLM
 */
export class ToolRegistry {
  private tools: Map<string, Tool>;

  constructor() {
    this.tools = new Map();
    this.registerBuiltinTools();
  }

  private registerBuiltinTools(): void {
    this.register(createBashExecTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name.
   * @param signal - Per-invocation AbortSignal forwarded to the tool handler.
   *                 Pass the session-level signal so SIGTERM aborts in-flight tool calls.
   */
  async execute(name: string, args: any, signal?: AbortSignal): Promise<any> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.handler(args, signal);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  size(): number {
    return this.tools.size;
  }
}
